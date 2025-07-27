import express from "express";
import multer from "multer";
import { parseStringPromise } from "xml2js";
import { gerarPDF } from "@alexssmusica/node-pdf-nfe";
import { Nota } from "../models/Nota.js";
import { getDb } from "../../db.js";
import { GridFSBucket, ObjectId } from "mongodb";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// GridFS setup
const db = getDb();
const bucket = new GridFSBucket(db, { bucketName: "pdfs" });

// POST /api/notas
router.post("/", upload.single("xml"), async (req, res) => {
  try {
    const xml = req.file.buffer.toString("utf-8");
    const { nfeProc: { NFe: { infNFe } } } = await parseStringPromise(xml, { explicitArray: false });
    const numero = infNFe.ide.nNF;

    // Upsert no MongoDB
    const notaData = {
      numero,
      dataEmissao: infNFe.ide.dhEmi,
      remetente: infNFe.emit,
      destinatario: infNFe.dest,
      transportadora: infNFe.transp || null,
      produtos: Array.isArray(infNFe.det) ? infNFe.det.map(d => d.prod) : [infNFe.det.prod],
      valorTotal: parseFloat(infNFe.total.ICMSTot.vNF),
      xmlTexto: xml
    };
    let nota = await Nota.findOneAndUpdate({ numero }, notaData, { new: true, upsert: true });

    // Gera PDF e envia pro GridFS
    const pdfStream = await gerarPDF(xml);
    const uploadStream = bucket.openUploadStream(`pdf-${numero}.pdf`);
    pdfStream.pipe(uploadStream);
    const fileId = await new Promise((resolve, reject) => {
      uploadStream.on("finish", () => resolve(uploadStream.id));
      uploadStream.on("error", reject);
    });

    nota.pdfFileId = fileId;
    nota = await nota.save();
    res.json(nota);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/notas
router.get("/", async (req, res) => {
  try {
    const filter = req.query.numero ? { numero: req.query.numero } : {};
    const list = await Nota.find(filter).sort({ criadoEm: -1 });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE all
router.delete("/", async (req, res) => {
  try {
    await Nota.deleteMany({});
    await db.collection("pdfs.files").deleteMany({});
    await db.collection("pdfs.chunks").deleteMany({});
    res.json({ message: "Todas as notas e PDFs foram apagados." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE single
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const nota = await Nota.findByIdAndDelete(id);
    if (!nota) return res.status(404).json({ error: "Nota não encontrada." });
    if (nota.pdfFileId) bucket.delete(new ObjectId(nota.pdfFileId));
    res.json({ message: `Nota ${id} excluída.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
