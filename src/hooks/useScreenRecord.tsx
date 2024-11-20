import { useState, useRef } from "react";

export const useScreenRecord = (session: string) => {
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [chunksUploaded, setChunksUploaded] = useState<number[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunkCountRef = useRef(0);
  const [uploadPromises, setUploadPromises] = useState<Promise<void>[]>([]);
  const sessionIdRef = useRef<string>(session);
  const [fileFullUrl, setFileFullUrl] = useState<string>();

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

      const combinedStream = new MediaStream([
        ...stream.getTracks(),
        ...audioStream.getTracks(),
      ]);

      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: "video/webm;codecs=vp9",
      });

      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = handleDataAvailable;
      mediaRecorder.start(1000);

      chunkCountRef.current = 0;
      setRecording(true);
      setStatus("Recording...");
      console.log("Recording started...");
    } catch (error) {
      console.error("Error starting recording:", error);
      setStatus("Error starting recording");
    }
  };

  const stopRecording = async () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      setRecording(false);
      setStatus("Stopped");

      await Promise.all(uploadPromises);

      const totalChunks = chunkCountRef.current;
      console.log("Final totalChunks:", totalChunks);

      try {
        const response = await fetch("http://localhost:8080/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ totalChunks, session: sessionIdRef.current }),
        });
        response.json().then((data) => {
          console.log("Finalization response:", data);
          setFileFullUrl(data.url);
        });
        console.log("Finalization request sent successfully.");
      } catch (error) {
        console.error("Error finalizing recording:", error);
      }
    }
  };

  const handleDataAvailable = async (event: BlobEvent) => {
    if (event.data.size > 0) {
      chunkCountRef.current += 1;
      console.log("Chunk size:", event.data.size);
      const uploadPromise = uploadChunk(event.data, chunkCountRef.current);
      setUploadPromises((prev) => [...prev, uploadPromise]);
    }
  };

  const uploadChunk = async (chunk: Blob, chunkIndex: number) => {
    const formData = new FormData();
    formData.append("videoChunk", chunk, `chunk_${chunkIndex}.webm`);
    formData.append("chunkIndex", chunkIndex.toString());
    formData.append("session", sessionIdRef.current);

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

  return {
    startRecording,
    stopRecording,
    recording,
    status,
    chunksUploaded,
    fileFullUrl,
  }
};