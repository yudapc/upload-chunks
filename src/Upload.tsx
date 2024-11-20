import { useState, useEffect, FC } from "react";
import axios from "axios";
import Dropzone from "react-dropzone";

// const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB per chunk
const CHUNK_SIZE = 128 * 1024; // 128 KB per chunk

interface Chunk {
  chunkIndex: number;
  fileChunk: Blob;
}

interface IProps {
  session: string;
}

const Upload: FC<IProps> = ({ session }) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadedChunks, setUploadedChunks] = useState<Set<number>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [finalFileName, setFinalFileName] = useState<string | null>(null);
  const [fileFullUrl, setFileFullUrl] = useState<string>();

  const splitFileIntoChunks = (file: File): Chunk[] => {
    const chunks: Chunk[] = [];
    let start = 0;
    let chunkIndex = 0;

    while (start < file.size) {
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const fileChunk = file.slice(start, end);
      chunks.push({ chunkIndex, fileChunk });
      start = end;
      chunkIndex++;
    }

    return chunks;
  };

  const validateFile = (file: File): boolean => {
    // const validTypes = ["video/mp4", "video/webm", "video/ogg"];
    // if (!validTypes.includes(file.type)) {
    //   setErrorMessage("Invalid file type. Please upload a video file.");
    //   return false;
    // }
    console.log('File Type: ', file.type);
    setErrorMessage(null);
    return true;
  };

  const handleFileDrop = (acceptedFiles: File[]) => {
    if (acceptedFiles && acceptedFiles.length > 0) {
      const selectedFile = acceptedFiles[0];
      if (validateFile(selectedFile)) {
        setFile(selectedFile);
        setUploadedChunks(new Set());
        setUploadProgress(0);
        setFinalFileName(null);
      }
    }
  };

  const uploadChunk = async (
    chunk: Chunk,
    fileName: string,
    totalChunks: number,
  ) => {
    const formData = new FormData();
    formData.append("chunkIndex", chunk.chunkIndex.toString());
    formData.append("videoChunk", chunk.fileChunk);
    formData.append("fileName", fileName);
    formData.append("totalChunks", totalChunks.toString());
    formData.append("session", session);

    try {
      const response = await axios.post(
        "http://localhost:8080/upload",
        formData,
      );
      console.log("Chunk uploaded successfully:", response.data);
      if (response.data.url) {
        setFileFullUrl(response.data.url);
      }
      setUploadedChunks((prev) => new Set(prev).add(chunk.chunkIndex));
    } catch (error) {
      console.error(`Failed to upload chunk ${chunk.chunkIndex}`, error);
      throw error;
    }
  };

  const uploadChunks = async (chunks: Chunk[], fileName: string) => {
    setIsUploading(true);

    try {
      let uploadedChunksCount = uploadedChunks.size;

      for (const chunk of chunks) {
        if (uploadedChunks.has(chunk.chunkIndex)) continue; // Skip already uploaded chunks
        await uploadChunk(chunk, fileName, chunks.length);

        uploadedChunksCount++;
        const progress = (uploadedChunksCount / chunks.length) * 100;
        setUploadProgress(progress);
      }

      setUploadProgress(100);
    } catch (error) {
      setErrorMessage("An error occurred during upload. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const startUpload = () => {
    if (!file) return;

    const chunks = splitFileIntoChunks(file);
    uploadChunks(chunks, file.name);
  };

  useEffect(() => {
    if (errorMessage) {
      setTimeout(() => setErrorMessage(null), 5000); // Clear error after 5 seconds
    }
  }, [errorMessage]);

  return (
    <div style={{ padding: "20px", maxWidth: "600px", margin: "auto" }}>
      <h1>Video Uploader</h1>
      <p>Session: {session}</p>
      <p>File Full URL: {fileFullUrl}</p>

      {!file ? (
        <Dropzone onDrop={handleFileDrop}>
          {({ getRootProps, getInputProps }) => (
            <div
              {...getRootProps()}
              style={{
                border: "2px dashed #ccc",
                padding: "20px",
                textAlign: "center",
                cursor: "pointer",
              }}
            >
              <input {...getInputProps()} />
              <p>Drag & drop your video file here, or click to select</p>
            </div>
          )}
        </Dropzone>
      ) : (
        <div>
          <p>
            <strong>Selected File:</strong> {file.name}
          </p>
          <p>
            <strong>File Size:</strong> {(file.size / (1024 * 1024)).toFixed(2)}{" "}
            MB
          </p>
        </div>
      )}

      {errorMessage && (
        <div
          style={{
            color: "red",
            marginTop: "10px",
            border: "1px solid red",
            padding: "10px",
            borderRadius: "5px",
          }}
        >
          {errorMessage}
        </div>
      )}

      {file && (
        <>
          <button
            onClick={startUpload}
            disabled={isUploading}
            style={{
              marginTop: "20px",
              padding: "10px 20px",
              backgroundColor: isUploading ? "#ccc" : "#007bff",
              color: "#fff",
              border: "none",
              borderRadius: "5px",
              cursor: isUploading ? "not-allowed" : "pointer",
            }}
          >
            {isUploading ? "Uploading..." : "Start Upload"}
          </button>

          <div style={{ marginTop: "20px" }}>
            <p>Upload Progress:</p>
            <div
              style={{
                width: "100%",
                height: "20px",
                backgroundColor: "#f3f3f3",
                borderRadius: "10px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${uploadProgress}%`,
                  height: "100%",
                  backgroundColor: "#007bff",
                  transition: "width 0.2s",
                }}
              />
            </div>
            <p>{uploadProgress.toFixed(2)}%</p>
          </div>
        </>
      )}

      {finalFileName && (
        <div style={{ marginTop: "20px" }}>
          <h3>Upload Completed!</h3>
          <p>
            Your file has been uploaded as: <strong>{finalFileName}</strong>
          </p>
        </div>
      )}
    </div>
  );
};

export default Upload;
