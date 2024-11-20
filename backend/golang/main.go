package main

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path"
	"strconv"
	"sync"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

var (
	uploadsDir     = "uploads"          // Folder untuk menyimpan video final
	tempChunksDir  = "temp_chunks"      // Folder sementara untuk menyimpan chunks
	writeStream    *os.File             // Stream untuk menulis file final
	receivedChunks = make(map[int]bool) // Melacak chunks yang diterima
	mu             sync.Mutex           // Mutex untuk mengamankan akses ke receivedChunks
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

	// Simpan chunk ke folder sementara
	chunkPath := path.Join(tempChunksDir, fmt.Sprintf("chunk_%d", chunkIndex))
	dst, err := os.Create(chunkPath)
	if err != nil {
		return c.JSON(500, map[string]string{"error": "Failed to save chunk"})
	}
	defer dst.Close()

	// Salin isi chunk ke file sementara
	if _, err := io.Copy(dst, src); err != nil {
		return c.JSON(500, map[string]string{"error": "Failed to write chunk"})
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
		return finalizeUpload(c, totalChunks)
	}

	return c.JSON(200, map[string]string{"message": fmt.Sprintf("Chunk %d received", chunkIndex)})
}

// finalizeUpload menggabungkan semua chunk menjadi satu file
func finalizeUpload(c echo.Context, totalChunks int) error {
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
		chunkPath := path.Join(tempChunksDir, fmt.Sprintf("chunk_%d", i))
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

	// Reset state
	mu.Lock()
	receivedChunks = make(map[int]bool)
	mu.Unlock()

	return c.JSON(200, map[string]interface{}{
		"message":  "Upload complete",
		"fileName": finalFilePath,
		"filePath": finalFilePath,
	})
}

// ensureDir memastikan direktori ada, jika tidak akan membuatnya
func ensureDir(dir string) {
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		os.MkdirAll(dir, 0o755)
	}
}
