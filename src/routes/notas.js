
// src/routes/notas.js
import express from "express";
import multer from "multer";
import { parseStringPromise } from "xml2js";
import { gerarPDF } from "@alexssmusica/node-pdf-nfe";
import { Nota } from "../models/Nota.js";
import mongoose from "mongoose";
import { GridFSBucket, ObjectId } from "mongodb";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Helper para obter o db nativo do driver a partir do mongoose
function getNativeDb() {
  const conn = mongoose.connection;
  if (!conn.db) {
    throw new Error("Mongoose ainda não conectado ao MongoDB");
  }
  return conn.db;
}

/**
 * POST /api/notas
 * - Recebe um XML (campo "xml")
 * - Faz upsert da Nota no MongoDB
 * - Gera PDF e salva no GridFS
 */
router.post("/", upload.single("xml"), async (req, res) => {
  try {
    const xml = req.file.buffer.toString("utf-8");
    const { nfeProc: { NFe: { infNFe } } } =
      await parseStringPromise(xml, { explicitArray: false });
    const numero = infNFe.ide.nNF;

    // Prepara dados da nota
    const notaData = {
      numero,
      dataEmissao: infNFe.ide.dhEmi,
      remetente: infNFe.emit,
      destinatario: infNFe.dest,
      transportadora: infNFe.transp || null,
      produtos: Array.isArray(infNFe.det)
        ? infNFe.det.map(d => d.prod)
        : [infNFe.det.prod],
      valorTotal: parseFloat(infNFe.total.ICMSTot.vNF),
      xmlTexto: xml
    };

    // Upsert da Nota
    let nota = await Nota.findOneAndUpdate(
      { numero },
      notaData,
      { new: true, upsert: true }
    );

    // Gera PDF e armazena no GridFS
    const db = getNativeDb();
    const bucket = new GridFSBucket(db, { bucketName: "pdfs" });

    const pdfStream = await gerarPDF(xml);
    const uploadStream = bucket.openUploadStream(`pdf-${numero}.pdf`);
    pdfStream.pipe(uploadStream);

    // Espera o upload terminar e captura o fileId
    const fileId = await new Promise((resolve, reject) => {
      uploadStream.on("finish", () => resolve(uploadStream.id));
      uploadStream.on("error", reject);
    });

    // Salva a referência no documento Nota
    nota.pdfFileId = fileId;
    nota = await nota.save();

    res.json(nota);
  } catch (err) {
    console.error("Erro ao processar XML/PDF:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/notas
 * - Lista todas as notas, ou filtra por ?numero=...
 */
router.get("/", async (req, res) => {
  try {
    const filter = req.query.numero ? { numero: req.query.numero } : {};
    const notas = await Nota.find(filter).sort({ criadoEm: -1 });
    res.json(notas);
  } catch (err) {
    console.error("Erro ao listar notas:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/notas
 * - Apaga todas as notas e limpa o bucket "pdfs" no GridFS
 */
router.delete("/", async (req, res) => {
  try {
    await Nota.deleteMany({});
    const db = getNativeDb();
    await db.collection("pdfs.files").deleteMany({});
    await db.collection("pdfs.chunks").deleteMany({});
    res.json({ message: "Todas as notas e PDFs foram apagados." });
  } catch (err) {
    console.error("Erro ao deletar tudo:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/notas/:id
 * - Apaga uma nota específica e seu PDF no GridFS
 */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const nota = await Nota.findByIdAndDelete(id);
    if (!nota) {
      return res.status(404).json({ error: "Nota não encontrada." });
    }

    if (nota.pdfFileId) {
      const db = getNativeDb();
      const bucket = new GridFSBucket(db, { bucketName: "pdfs" });
      await bucket.delete(new ObjectId(nota.pdfFileId));
    }

    res.json({ message: `Nota ${id} excluída.` });
  } catch (err) {
    console.error("Erro ao deletar nota:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

