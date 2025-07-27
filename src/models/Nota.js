import mongoose from "mongoose";
const NotaSchema = new mongoose.Schema({
  numero: { type: String, required: true, unique: true },
  dataEmissao: String,
  remetente: Object,
  destinatario: Object,
  transportadora: Object,
  produtos: Array,
  valorTotal: Number,
  xmlTexto: String,
  xmlPath: String,
  pdfUrl: String,
  criadoEm: { type: Date, default: Date.now }
});
export const Nota = mongoose.model("Nota", NotaSchema);

