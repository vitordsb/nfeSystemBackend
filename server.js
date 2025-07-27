import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { connect } from "./db.js";
import notasRouter from "./src/routes/notas.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

await connect();

app.use("/api/notas", notasRouter);

app.use(
  "/pdfs",
  express.static(path.join(__dirname, "uploads", "pdf"))
);

const PORT = 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
