import "./App.css";
import ScreenRecord from "./ScreenRecord";
import Upload from "./Upload";
import { v4 as uuidv4 } from 'uuid';

export default function App() {
  const session = uuidv4();

  return (
    <main>
      React ⚛️ + Vite ⚡ + Replit 🌀
      <Upload session={session} />
      <ScreenRecord session={session} />
    </main>
  );
}
