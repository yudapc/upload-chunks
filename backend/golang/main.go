package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"cloud.google.com/go/storage"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"google.golang.org/api/option"
)

var (
	uploadsDir                 = "uploads"          // Folder untuk menyimpan video final
	tempChunksDir              = "temp_chunks"      // Folder sementara untuk menyimpan chunks
	receivedChunks             = make(map[int]bool) // Melacak chunks yang diterima
	receivedScreenRecordChunks = make(map[int]bool) // Melacak chunks yang diterima
	mu                         sync.Mutex           // Mutex untuk mengamankan akses ke receivedChunks
	bucketName                 = "fsr-bucket"       // Replace with your bucket name
	gcsKeyFilename             = "./gcp-key.json"   // Path ke file kunci Google Cloud Storage
	isUploadToGCS              = true               // Ganti dengan true jika ingin mengupload ke Google Cloud Storage
)

func main() {
	// Pastikan folder 'uploads/' dan 'temp_chunks/' ada
	ensureDir(uploadsDir)
	ensureDir(tempChunksDir)

	// Inisialisasi Echo
	e := echo.New()
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: []string{"*"},            // Mengizinkan semua origin
		AllowMethods: []string{echo.POST},      // Mengizinkan POST
		AllowHeaders: []string{"Content-Type"}, // Header yang diizinkan
	}))

	// Endpoint untuk upload chunk
	e.POST("/upload", uploadChunk)
	e.POST("/upload-screen-recording", uploadScreenRecordingChunk)
	e.POST("/finalize", finalizeUploadScreenRecording)
	e.GET("/screen-recording/:session", getScreenRecordingUrl)
	e.Static("/files/uploads", uploadsDir)

	// Jalankan server
	e.Logger.Fatal(e.Start(":8080"))
}

// uploadChunk menangani unggahan chunk dari client
func uploadChunk(c echo.Context) error {
	// Mendapatkan informasi chunk dari form data
	chunkIndex, err := strconv.Atoi(c.FormValue("chunkIndex"))
	if err != nil {
		return c.JSON(400, map[string]string{"error": "Invalid chunkIndex"})
	}

	totalChunks, err := strconv.Atoi(c.FormValue("totalChunks"))
	if err != nil {
		return c.JSON(400, map[string]string{"error": "Invalid totalChunks"})
	}

	session := c.FormValue("session")

	// Mendapatkan file chunk dari request
	file, err := c.FormFile("videoChunk")
	if err != nil {
		return c.JSON(400, map[string]string{"error": "Failed to read chunk"})
	}

	// Buka file chunk
	src, err := file.Open()
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Failed to open chunk file"})
	}
	defer src.Close()

	if isUploadToGCS {
		// Buat file sementara untuk menyimpan chunk
		tempFile, err := os.CreateTemp("", "chunk-*.webm")
		if err != nil {
			return c.JSON(500, map[string]string{"error": "Failed to create temp file"})
		}
		defer tempFile.Close()

		// Salin isi chunk ke file sementara
		if _, err := io.Copy(tempFile, src); err != nil {
			return c.JSON(500, map[string]string{"error": "Failed to write chunk"})
		}

		// Unggah chunk ke GCS
		chunkPath := fmt.Sprintf("%s_chunk_%d.webm", session, chunkIndex)
		if _, _, err := uploadToGCS(chunkPath, tempFile); err != nil {
			return c.JSON(500, map[string]string{"error": "Failed to upload chunk to GCS"})
		}
	} else {
		// Simpan chunk ke folder sementara
		chunkPath := path.Join(tempChunksDir, fmt.Sprintf("%s_chunk_%d", session, chunkIndex))
		dst, err := os.Create(chunkPath)
		if err != nil {
			return c.JSON(500, map[string]string{"error": "Failed to save chunk"})
		}
		defer dst.Close()

		// Salin isi chunk ke file sementara
		if _, err := io.Copy(dst, src); err != nil {
			return c.JSON(500, map[string]string{"error": "Failed to write chunk"})
		}
	}

	// Tandai chunk sebagai diterima
	mu.Lock()
	receivedChunks[chunkIndex] = true
	mu.Unlock()

	fmt.Printf("Chunk %d processed\n", chunkIndex)

	// Periksa apakah semua chunk sudah diterima
	mu.Lock()
	allReceived := len(receivedChunks) == totalChunks
	mu.Unlock()

	if allReceived {
		return finalizeUpload(c, totalChunks, session)
	}

	return c.JSON(200, map[string]string{"message": fmt.Sprintf("Chunk %d received", chunkIndex)})
}

// finalizeUpload menggabungkan semua chunk menjadi satu file
func finalizeUpload(c echo.Context, totalChunks int, session string) error {
	finalFilePath := path.Join(uploadsDir, fmt.Sprintf("%s_final_video.webm", uuid.New().String()))

	// Buka file untuk menulis file final
	finalFile, err := os.Create(finalFilePath)
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Failed to create final file"})
	}
	defer finalFile.Close()

	// Gabungkan semua chunk
	writer := bufio.NewWriter(finalFile)
	for i := 0; i < totalChunks; i++ {
		chunkPath := path.Join(tempChunksDir, fmt.Sprintf("%s_chunk_%d", session, i))
		chunkFile, err := os.Open(chunkPath)
		if err != nil {
			return c.JSON(500, map[string]string{"error": fmt.Sprintf("Failed to open chunk %d", i)})
		}

		// Salin isi chunk ke file final
		if _, err := io.Copy(writer, chunkFile); err != nil {
			chunkFile.Close()
			return c.JSON(500, map[string]string{"error": fmt.Sprintf("Failed to merge chunk %d", i)})
		}
		chunkFile.Close()

		// Hapus chunk setelah digabung
		os.Remove(chunkPath)
	}

	// Selesaikan penulisan file final
	writer.Flush()

	fmt.Printf("Final video saved as %s\n", finalFilePath)

	if isUploadToGCS {
		// Upload file ke Google Cloud Storage
		ctx := context.Background()
		client, err := storage.NewClient(ctx, option.WithCredentialsFile(gcsKeyFilename))
		if err != nil {
			return c.JSON(500, map[string]string{"error": "Failed to create Google Cloud Storage client"})
		}
		defer client.Close()

		bucket := client.Bucket(bucketName)
		object := bucket.Object(path.Join("testing", path.Base(finalFilePath)))
		wc := object.NewWriter(ctx)
		finalFile.Seek(0, io.SeekStart) // Reset file pointer to the beginning
		if _, err := io.Copy(wc, finalFile); err != nil {
			return c.JSON(500, map[string]string{"error": "Failed to upload file to Google Cloud Storage"})
		}
		if err := wc.Close(); err != nil {
			return c.JSON(500, map[string]string{"error": "Failed to close Google Cloud Storage writer"})
		}

		// Delete the file from the uploads directory after successful upload
		if err := os.Remove(finalFilePath); err != nil {
			return c.JSON(500, map[string]string{"error": "Failed to delete file from uploads directory"})
		}
	}

	// Reset state
	mu.Lock()
	receivedChunks = make(map[int]bool)
	mu.Unlock()

	host := "http://localhost"
	port := "8080"
	finalFilePath = fmt.Sprintf("%s:%s/files/%s", host, port, finalFilePath)

	return c.JSON(200, map[string]interface{}{
		"message": "Upload complete",
		"url":     finalFilePath,
	})
}

// Screen Recording
type FinalizeRequest struct {
	TotalChunks int    `json:"totalChunks"`
	Session     string `json:"session"`
}

func uploadScreenRecordingChunk(c echo.Context) error {
	chunkIndex := c.FormValue("chunkIndex")
	session := c.FormValue("session")
	file, err := c.FormFile("videoChunk")
	if err != nil {
		log.Printf("Error get file from payload: %v", err)
		return c.String(http.StatusBadRequest, "Failed to parse chunk")
	}

	// Buka file chunk
	chunkPath := filepath.Join("temp_chunks", session+"_chunk_"+chunkIndex+".webm")
	src, err := file.Open()
	if err != nil {
		log.Printf("Error open file: %v", err)
		return err
	}
	defer src.Close()

	// Buat file sementara untuk menyimpan chunk
	tempFile, err := os.CreateTemp("", "chunk-*.webm")
	if err != nil {
		log.Printf("Error CreateTemp: %v", err)
		return err
	}
	defer tempFile.Close()

	// Salin isi chunk ke file sementara
	if _, err := io.Copy(tempFile, src); err != nil {
		log.Printf("Error Copy file: %v", err)
		return err
	}

	// Unggah chunk ke GCS
	if _, _, err := uploadToGCS(chunkPath, tempFile); err != nil {
		log.Printf("Error upload to GCS: %v", err)
		return err
	}

	// Tandai chunk sebagai diterima
	index, _ := strconv.Atoi(chunkIndex)
	receivedScreenRecordChunks[index] = true
	fmt.Println("Received chunk:", chunkIndex)

	return c.String(http.StatusOK, fmt.Sprintf("Chunk %s uploaded", chunkIndex))
}

func finalizeUploadScreenRecording(c echo.Context) error {
	req := new(FinalizeRequest)
	if err := c.Bind(req); err != nil {
		return err
	}

	fmt.Println("Finalizing upload with totalChunks:", req.TotalChunks)

	totalChunks := req.TotalChunks
	session := req.Session

	// finalFilePath := path.Join(uploadsDir, fmt.Sprintf("%s/%s_final_video.webm", session, uuid.New().String()))
	finalDir := path.Join(uploadsDir, session)
	finalFilePath := path.Join(finalDir, fmt.Sprintf("%s_final_video.webm", uuid.New().String()))

	// Buat direktori jika belum ada
	if err := os.MkdirAll(finalDir, os.ModePerm); err != nil {
		log.Printf("Error directory not exist: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create directory"})
	}

	// Buka file untuk menulis file final
	finalFile, err := os.Create(finalFilePath)
	if err != nil {
		log.Printf("Error write final file: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to create final file"})
	}
	defer finalFile.Close()

	// Gabungkan semua chunk
	writer := bufio.NewWriter(finalFile)
	ctx := context.Background()
	client, err := storage.NewClient(ctx, option.WithCredentialsFile(gcsKeyFilename))
	if err != nil {
		log.Printf("Error create GCS client: %v", err)
		return c.JSON(500, map[string]string{"error": "Failed to create Google Cloud Storage client"})
	}
	defer client.Close()

	bucket := client.Bucket(bucketName)

	for i := 1; i < totalChunks; i++ {
		chunkPath := fmt.Sprintf("%s_chunk_%d.webm", session, i)
		object := bucket.Object(path.Join("testing", chunkPath))
		reader, err := object.NewReader(ctx)
		if err != nil {
			log.Printf("Error open chunk: %v", err)
			return c.JSON(500, map[string]string{"error": fmt.Sprintf("Failed to open chunk %d from GCS", i)})
		}
		defer reader.Close()

		// Salin isi chunk dari GCS ke file final
		if _, err := io.Copy(writer, reader); err != nil {
			log.Printf("Error merge chunk: %v", err)
			return c.JSON(500, map[string]string{"error": fmt.Sprintf("Failed to merge chunk %d from GCS", i)})
		}
		reader.Close()

		// Hapus chunk dari GCS setelah digabung
		if err := object.Delete(ctx); err != nil {
			log.Printf("Error delete chunk: %v", err)
			return c.JSON(500, map[string]string{"error": fmt.Sprintf("Failed to delete chunk %d from GCS", i)})
		}
	}

	// Selesaikan penulisan file final
	writer.Flush()

	fmt.Printf("Final video saved as %s\n", finalFilePath)
	var url string

	if isUploadToGCS {
		// Upload file ke Google Cloud Storage
		_, _, err := uploadToGCS(finalFilePath, finalFile)
		if err != nil {
			log.Printf("Error upload to GCS: %v", err)
			return c.JSON(500, map[string]string{"error": err.Error()})
		}

		// time.Sleep(2 * time.Second)

		// // Generate signed URL
		// url, err = generateSignedURL(bucketName, object.ObjectName(), client)
		// if err != nil {
		// 	log.Printf("Error generate signed url: %v", err)
		// 	return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate signed URL"})
		// }
	} else {
		host := "http://localhost"
		port := "8080"
		url = fmt.Sprintf("%s:%s/files/%s", host, port, finalFilePath)
	}

	// Reset state
	mu.Lock()
	receivedChunks = make(map[int]bool)
	mu.Unlock()

	response := map[string]string{"url": url, "message": "Upload complete"}
	responseJSON, _ := json.Marshal(response)
	return c.String(http.StatusOK, string(responseJSON))
}

func uploadToGCS(finalFilePath string, finalFile *os.File) (*storage.Client, *storage.ObjectHandle, error) {
	ctx := context.Background()
	client, err := storage.NewClient(ctx, option.WithCredentialsFile(gcsKeyFilename))
	if err != nil {
		return nil, nil, fmt.Errorf("Failed to create Google Cloud Storage client: %v", err)
	}
	defer client.Close()

	bucket := client.Bucket(bucketName)
	object := bucket.Object(path.Join("testing", path.Base(finalFilePath)))
	wc := object.NewWriter(ctx)
	finalFile.Seek(0, io.SeekStart) // Reset file pointer to the beginning
	if _, err := io.Copy(wc, finalFile); err != nil {
		return nil, nil, fmt.Errorf("Failed to upload file to Google Cloud Storage: %v", err)
	}
	if err := wc.Close(); err != nil {
		return nil, nil, fmt.Errorf("Failed to close Google Cloud Storage writer: %v", err)
	}

	return client, object, nil
}

func generateSignedURL(bucketName, objectName string, client *storage.Client) (string, error) {
	opts := &storage.SignedURLOptions{
		Scheme:  storage.SigningSchemeV4,
		Method:  "GET",
		Expires: time.Now().Add(15 * time.Minute), // URL valid for 15 minutes
	}
	url, err := client.Bucket(bucketName).SignedURL(objectName, opts)
	if err != nil {
		return "", fmt.Errorf("unable to generate signed URL: %w", err)
	}
	return url, nil
}

// ensureDir memastikan direktori ada, jika tidak akan membuatnya
func ensureDir(dir string) {
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		os.MkdirAll(dir, 0o755)
	}
}
