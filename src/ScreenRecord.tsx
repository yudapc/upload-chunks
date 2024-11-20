import React, { useState, useEffect, useRef } from "react";
import { useReactMediaRecorder } from "react-media-recorder";
import axios from "axios";

// const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB per chunk
const CHUNK_SIZE = 128 * 1024; // 128 KB per chunk

interface Chunk {
  chunkIndex: number;
  fileChunk: Blob;
}

const ScreenRecord: React.FC = () => {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [finalFileName, setFinalFileName] = useState<string | null>(null);
  const [recordedBlobs, setRecordedBlobs] = useState<Blob[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const { status, startRecording, stopRecording, mediaBlobUrl, blobs } =
    useReactMediaRecorder({
      audio: false,
      video: true,
      screen: true,
    });

  const startScreenRecording = () => {
    startRecording();
    setIsRecording(true);
  };

  // Split file into chunks
  const splitFileIntoChunks = (file: Blob): Chunk[] => {
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

  // Upload a single chunk
  const uploadChunk = async (
    chunk: Chunk,
    fileName: string,
    totalChunks: number,
  ) => {
    const formData = new FormData();
    formData.append("chunkIndex", chunk.chunkIndex.toString());
    formData.append("videoChunk", chunk.fileChunk);
    formData.append("fileName", fileName);
    formData.append("totalChunks", totalChunks.toString()); // Tambahkan total chunks

    try {
      await axios.post(
        "https://47883b04-eda5-49d8-857e-200bfa1c6f56-00-cvycpy6ts6gi.worf.replit.dev:8080/upload",
        formData,
      );
      setUploadProgress((prev) => {
        const newProgress = (prev + 100 / totalChunks).toFixed(2);
        if (parseFloat(newProgress) >= 100) {
          setFinalFileName(fileName);
        }
        return parseFloat(newProgress);
      });
    } catch (error) {
      console.error(`Failed to upload chunk ${chunk.chunkIndex}`, error);
      setErrorMessage("An error occurred during upload. Please try again.");
    }
  };

  // Upload all chunks with resumable support
  const uploadChunks = async (chunks: Chunk[], fileName: string) => {
    setIsUploading(true);

    try {
      for (const chunk of chunks) {
        await uploadChunk(chunk, fileName, chunks.length);
      }
    } catch (error) {
      console.error("An error occurred during upload.", error);
      setErrorMessage("An error occurred during upload. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  // Handle recording and upload
  useEffect(() => {
    if (blobs?.length > 0) {
      const latestBlob = blobs[blobs.length - 1];
      setRecordedBlobs((prev) => [...prev, latestBlob]);
    }
  }, [blobs]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (isRecording && recordedBlobs.length > 0) {
        // Upload the last 10 seconds of recording
        const last10Seconds = recordedBlobs.slice(
          Math.max(recordedBlobs.length - 10, 0),
        );
        const combinedBlob = new Blob(last10Seconds, {
          type: "video/webm",
        });

        uploadChunks(
          splitFileIntoChunks(combinedBlob),
          "screen_recording.webm",
        );
      }
    }, 10000);

    return () => {
      clearInterval(intervalId);
    };
  }, [isRecording, recordedBlobs]);

  // Stop recording and upload when user stops sharing screen
  useEffect(() => {
    const handleStreamEnd = () => {
      if (isRecording) {
        stopRecording();
        setIsRecording(false);
        setUploadProgress(0);

        // Upload remaining recorded blobs
        const remainingBlobs = recordedBlobs;
        const combinedBlob = new Blob(remainingBlobs, {
          type: "video/webm",
        });
        uploadChunks(
          splitFileIntoChunks(combinedBlob),
          "screen_recording.webm",
        );
      }
    };

    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.onstop = handleStreamEnd;
    }

    return () => {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.onstop = null;
      }
    };
  }, [isRecording, recordedBlobs, mediaRecorderRef]);

  return (
    <div style={{ padding: "20px", maxWidth: "600px", margin: "auto" }}>
      <h1>Screen Recorder</h1>

      {!isRecording ? (
        <button onClick={startScreenRecording} disabled={status !== "idle"}>
          Start Recording
        </button>
      ) : (
        <button onClick={stopRecording} disabled={status !== "recording"}>
          Stop Recording
        </button>
      )}

      {mediaBlobUrl && <video src={mediaBlobUrl} controls autoPlay muted />}

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

      {finalFileName && (
        <div style={{ marginTop: "20px" }}>
          <h3>Upload Completed!</h3>
          <p>
            Your file has been uploaded as: <strong>{finalFileName}</strong>
          </p>
        </div>
      )}

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
    </div>
  );
};

export default ScreenRecord;
