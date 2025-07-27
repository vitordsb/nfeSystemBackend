import mongoose from "mongoose";

export async function connect() {
  try {
    await mongoose.connect("mongodb+srv://vitordsb2019:tkhibbk3LraNFGDV@cluster0.hu7ab8n.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0");
    console.log("MongoDB conectado!");
  } catch (err) {
    console.error("Erro ao conectar no MongoDB:", err.message);
  }
}
