const express = require("express");
const fs = require("fs");
const multer = require("multer");
const path = require("path");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();
const upload = multer({ dest: "temp_chunks/" });
const PORT = 8080;

const uploadsDir = "uploads"; // Folder untuk menyimpan video final
let writeStream; // Stream untuk menulis file final
let receivedChunks = new Set(); // Melacak _chunk_ yang sudah diterima
let allChunksUploaded = false; // Menandai apakah semua chunk sudah diunggah

// Middleware CORS
app.use(
  cors({
    origin: "*", // Mengizinkan semua asal (origin)
    methods: ["GET", "POST"], // Mengizinkan metode tertentu
    allowedHeaders: ["Content-Type"], // Header yang diizinkan
  }),
);

// Pastikan folder 'uploads/' ada sebelum server berjalan
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Endpoint untuk upload _chunk_
app.post("/upload", upload.single("videoChunk"), (req, res) => {
  const chunkIndex = req.body.chunkIndex; // Nomor _chunk_
  const totalChunks = req.body.totalChunks; // Total jumlah _chunk_
  const { file } = req;

  if (!chunkIndex || !totalChunks) {
    return res.status(400).send("Chunk index and total chunks are required.");
  }

  // Jika _chunk_ sudah diterima sebelumnya, abaikan
  if (receivedChunks.has(chunkIndex)) {
    fs.unlinkSync(file.path); // Hapus file sementara
    return res.status(200).send(`Chunk ${chunkIndex} already received`);
  }

  // Inisialisasi writeStream untuk file final jika belum ada
  if (!writeStream) {
    const tempFilePath = path.join(uploadsDir, "temp_video.webm");
    writeStream = fs.createWriteStream(tempFilePath, { flags: "a" });
  }

  // Proses _chunk_
  const readStream = fs.createReadStream(file.path);
  readStream.pipe(writeStream, { end: false });

  readStream.on("end", () => {
    fs.unlinkSync(file.path); // Hapus file sementara
    receivedChunks.add(chunkIndex); // Tandai _chunk_ sebagai diterima
    console.log(`Chunk ${chunkIndex} processed`);

    // Jika semua _chunk_ telah diterima, proses penggabungan selesai
    if (receivedChunks.size === parseInt(totalChunks)) {
      allChunksUploaded = true; // Tandai semua _chunk_ selesai diunggah
      finalizeUpload(res); // Proses finalisasi file
    } else {
      res.status(200).send(`Chunk ${chunkIndex} received`);
    }
  });

  readStream.on("error", (err) => {
    console.error(`Error processing chunk ${chunkIndex}:`, err);
    res.status(500).send("Error processing chunk");
  });
});

// Proses finalisasi file (gabungkan _chunk_ dan tambahkan UUID)
function finalizeUpload(res) {
  const tempFilePath = path.join(uploadsDir, "temp_video.webm");
  const uniqueFileName = `${uuidv4()}_final_video.webm`;
  const finalFilePath = path.join(uploadsDir, uniqueFileName);

  // Tutup writeStream sebelum mengganti nama file
  writeStream.end(() => {
    fs.rename(tempFilePath, finalFilePath, (err) => {
      if (err) {
        console.error("Error finalizing video:", err);
        return res.status(500).send("Error finalizing video");
      }

      console.log(`Final video saved as ${uniqueFileName}`);
      // Reset state untuk upload berikutnya
      writeStream = null;
      receivedChunks = new Set();
      allChunksUploaded = false;

      res.status(200).send({
        message: "Upload complete",
        fileName: uniqueFileName,
        filePath: finalFilePath,
      });
    });
  });
}

// Jalankan server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
