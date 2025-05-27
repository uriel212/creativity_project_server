import express from 'express';
import cors from 'cors';
import multer from 'multer';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import speech from '@google-cloud/speech';
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const {Translate} = require('@google-cloud/translate').v2;
import { TextToSpeechClient } from '@google-cloud/text-to-speech';


// Iniciando express y configurando CORS
const app = express();
app.use(express.json());
app.use(cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
}));

// Configurando multer para manejar archivos de audio en memoria 
// Multer es un middleware para manejar multipart/form-data, que se utiliza para subir archivos
// En este caso, se configura para almacenar los archivos en memoria
const upload = multer({ storage: multer.memoryStorage() });

// DEFINIENDO CLIENTES DE GOOGLE CLOUD
// Speech-to-Text
// Text-to-Speech
// Translation
const client = new speech.SpeechClient();
const translateClient =  new Translate();
const ttsClient = new TextToSpeechClient();

// Configurando la carpeta para almacenar los archivos de audio
// Se crea una carpeta llamada 'audio_files' en el directorio actual si no existe
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const audioFolder = path.join(__dirname, 'audio_files');
if (!fs.existsSync(audioFolder)) {
    fs.mkdirSync(audioFolder);
}

// Exponiendo carpeta local './audio_files' para acceder a los archivos de audio generados
app.use('/audio', express.static(path.join(__dirname, 'audio_files')));
// Inicializando Service Account Credentials para Google Cloud
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(__dirname, 'Your key generated on google cloud.json');

// Función para transcribir audio utilizando Google Cloud Speech-to-Text API
const speechToText = async (audioFile) => {
    try {
        const audioBytes = audioFile.buffer.toString('base64');
        const request = {
            audio: { content: audioBytes },
            config: {
                encoding: 'WEBM_OPUS',
                sampleRateHertz: 48000,
                languageCode: 'es-GT', 
            },
        };

        const [response] = await client.recognize(request);
        const transcription = response.results
            .map(result => result.alternatives[0].transcript)
            .join(' ');

        return transcription;
    } catch (error) {
        console.error('Error transcribing audio:', error);
    }
}

// Función para traducir texto utilizando Google Cloud Translation API
// Esta función toma un texto y su idioma de origen y devuelve la traducción al inglés
const translateText = async(text, textLang = 'en') => {
    try {
        const [translation] = await translateClient.translate(text, textLang);
        return translation;
    } catch (error) {
        console.error('Error translating text:', error);
    }
}

// Función para sintetizar texto a voz utilizando Google Cloud Text-to-Speech API
// Esta función toma un texto y devuelve el audio sintetizado en formato LINEAR16
// La función utiliza la voz en inglés (en-US) y el género de voz neutral
const synthesizer = async (text) => {
    try {
        const request = {
            input: { text },
            voice: { languageCode: 'en-US', ssmlGender: 'NEUTRAL' },
            audioConfig: { audioEncoding: 'LINEAR16' },
        };
        const [response] = await ttsClient.synthesizeSpeech(request);
        return response.audioContent;
    } catch (error) {
        console.error('Error synthesizing speech:', error);
    }
}


// upload.single('audioData') es un middleware de multer que maneja la subida de un solo archivo
// 'audioData' es el nombre del campo en el formulario que contiene el archivo de audio
// La función recibe el archivo de audio y lo procesa utilizando Google Cloud Speech-to-Text API
app.post('/api/record_audio', upload.single('audioData'), async (req, res) => {
    try {
        const fileName = req.body.fileName;
        const audioFile = req.file;

        if (!audioFile || !fileName) {
            return res.status(400).send({ error: 'Audio data and file name are required' });
        }

        const filePath = path.join(__dirname, 'audio_files', fileName);
        fs.writeFileSync(filePath, audioFile.buffer);

        const transcription = await speechToText(audioFile);

        fs.unlinkSync(filePath);

        const translatedText = await translateText(transcription, 'en');

        res.status(200).send({ message: 'Transcription successful', audioTranscription: transcription, translatedText: translatedText });
    } catch (error) {
        console.error('Error processing audio:', error);
        res.status(500).send({ error: 'Failed to process audio', error });
    }
});

// Enpoint para sintetizar texto a voz
// recibe el texto traducido para enviarlo al modelo de Text To Speech de google
app.post('/api/synthesize', async (req, res) => {
        try {
            const { text } = req.body;

            if (!text) {
                return res.status(400).send({ error: 'Text is required for synthesis' });
            }

            const audioBuffer = await synthesizer(text);

            const audioFileName = `output_${Date.now()}.wav`;
            const audioFilePath = path.join(audioFolder, audioFileName);
        
            fs.writeFileSync(audioFilePath, audioBuffer);

            res.status(200).send({
              audioURL: `http://localhost:3001/audio/${audioFileName}`,
            });
            
          } catch (error) {
            console.error('Error al sintetizar texto:', error);
            res.status(500).send({ error: 'Failed to synthesize text' });
          }

})

app.listen(3001, () => {
    console.log('Server is running on port 3001');
})
