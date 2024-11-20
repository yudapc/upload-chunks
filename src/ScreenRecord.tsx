import React, { useState, useRef } from "react";

const ScreenRecorder = () => {
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [chunksUploaded, setChunksUploaded] = useState<number[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunkCountRef = useRef(0); // Counter untuk jumlah chunk
  const [uploadPromises, setUploadPromises] = useState<Promise<void>[]>([]);

  // Start screen and audio recording
  const startRecording = async () => {
    try {
      setStatus("Initializing...");
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      // Merge audio and video streams
      const combinedStream = new MediaStream([
        ...stream.getTracks(),
        ...audioStream.getTracks(),
      ]);

      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: "video/webm;codecs=vp9",
      });

      // Store MediaRecorder instance
      mediaRecorderRef.current = mediaRecorder;

      // Start recording and upload chunks
      mediaRecorder.ondataavailable = handleDataAvailable;
      mediaRecorder.start(1000); // Create chunks every 1 second

      chunkCountRef.current = 0; // Reset chunk counter
      setRecording(true);
      setStatus("Recording...");
      console.log("Recording started...");
    } catch (error) {
      console.error("Error starting recording:", error);
      setStatus("Error starting recording");
    }
  };

  // Stop recording
  const stopRecording = async () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      setRecording(false);
      setStatus("Stopped");

      // Wait for all uploadChunk promises to resolve
      await Promise.all(uploadPromises);

      // Send totalChunks information after recording is stopped
      const totalChunks = chunkCountRef.current;
      console.log("Final totalChunks:", totalChunks);

      try {
        await fetch("http://localhost:8080/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ totalChunks }),
        });
        console.log("Finalization request sent successfully.");
      } catch (error) {
        console.error("Error finalizing recording:", error);
      }
    }
  };

  // Handle data chunks from MediaRecorder
  const handleDataAvailable = async (event: BlobEvent) => {
    if (event.data.size > 0) {
      chunkCountRef.current += 1; // Increment chunk count
      console.log("Chunk size:", event.data.size);
      const uploadPromise = uploadChunk(event.data, chunkCountRef.current);
      setUploadPromises((prev) => [...prev, uploadPromise]);
    }
  };

  // Upload chunk to server
  const uploadChunk = async (chunk: Blob, chunkIndex: number) => {
    const formData = new FormData();
    formData.append("videoChunk", chunk, `chunk_${chunkIndex}.webm`);
    formData.append("chunkIndex", chunkIndex.toString());

    try {
      const response = await fetch("http://localhost:8080/upload-screen-recording", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        console.log(`Chunk ${chunkIndex} uploaded successfully`);
        setChunksUploaded((prev) => [...prev, chunkIndex]);
      } else {
        console.error("Failed to upload chunk", await response.text());
      }
    } catch (error) {
      console.error("Error uploading chunk:", error);
    }
  };

  return (
    <div>
      <h1>Screen & Audio Recorder</h1>
      <p>Status: {status}</p>
      <button onClick={startRecording} disabled={recording}>
        Start Recording
      </button>
      <button onClick={stopRecording} disabled={!recording}>
        Stop Recording
      </button>
      <p>Chunks uploaded: {chunksUploaded.length}</p>
    </div>
  );
};

export default ScreenRecorder;
