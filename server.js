import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { connect } from "./db.js";
import notasRouter from "./src/routes/notas.js";
import { GridFSBucket, ObjectId } from "mongodb";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
await connect();

app.use("/api/notas", notasRouter);

// Rota para servir PDF do GridFS
const db = getDb();
const bucket = new GridFSBucket(db, { bucketName: "pdfs" });
app.get("/api/notas/pdf/:id", (req, res) => {
  try {
    const fileId = new ObjectId(req.params.id);
    res.setHeader("Content-Type", "application/pdf");
    bucket.openDownloadStream(fileId).pipe(res);
  } catch {
    res.status(404).json({ error: "PDF não encontrado" });
  }
});

app.listen(3001, () => console.log("Server running on http://localhost:3001"));
