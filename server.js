
// server.js
import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import notasRouter from "./src/routes/notas.js";
import { GridFSBucket, ObjectId } from "mongodb";
import { Nota } from "./src/models/Nota.js";

dotenv.config();

const {
  MONGO_USER,
  MONGO_PASS,
  MONGO_HOST,
  PORT = 3001
} = process.env;

async function main() {
  // Conecta no MongoDB via Mongoose
  await mongoose.connect(
    `mongodb+srv://${MONGO_USER}:${MONGO_PASS}@${MONGO_HOST}/?retryWrites=true&w=majority`
  );
  console.log("MongoDB conectado!");

  const app = express();
  app.use(express.json());

  // Monta o seu router de notas em /api/notas
  app.use("/api/notas", notasRouter);

  // Após o mongoose.connection abrir, pega o db nativo e inicializa o GridFSBucket
  mongoose.connection.once("open", () => {
    const db = mongoose.connection.db;
    const bucket = new GridFSBucket(db, { bucketName: "pdfs" });

    // Rota para baixar/visualizar o PDF de uma nota pelo seu _id
    app.get("/api/notas/:id/pdf", async (req, res) => {
      try {
        const nota = await Nota.findById(req.params.id);
        if (!nota || !nota.pdfFileId) {
          return res.status(404).json({ error: "PDF não encontrado para esta nota." });
        }
        // Ajusta o header para abrir no browser
        res.setHeader("Content-Type", "application/pdf");
        const downloadStream = bucket.openDownloadStream(
          new ObjectId(nota.pdfFileId)
        );
        downloadStream.pipe(res);
      } catch (err) {
        console.error("Erro ao buscar PDF:", err);
        res.status(500).json({ error: err.message });
      }
    });

    app.listen(PORT, () =>
      console.log(`Servidor rodando em http://localhost:${PORT}`)
    );
  });
}

main().catch((err) => {
  console.error("Erro ao iniciar o servidor:", err);
  process.exit(1);
});

