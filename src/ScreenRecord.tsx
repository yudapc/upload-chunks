import { useScreenRecord } from "./hooks/useScreenRecord";
import { FC } from 'react';

interface IProps {
  session: string;
}

const ScreenRecorder: FC<IProps> = ({ session }) => {
  const {
    startRecording,
    stopRecording,
    recording,
    status,
    chunksUploaded,
    fileFullUrl,
  } = useScreenRecord(session);

  return (
    <div style={{ padding: "20px", maxWidth: "600px", margin: "auto" }}>
      <h1>Screen & Audio Recorder</h1>
      <p>Session: {session}</p>
      <p>Status: {status}</p>
      <p>File Full URL: {fileFullUrl}</p>
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
