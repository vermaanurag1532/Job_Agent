import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);

export async function extractPDFText(filePath) {
    try {
        // Check if file exists first
        if (!fs.existsSync(filePath)) {
            console.error(`PDF file not found: ${filePath}`);
            return '';
        }

        const pdf = require('pdf-parse');
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdf(dataBuffer);
        return data.text;
    } catch (error) {
        console.error('Error extracting PDF text:', error);
        return '';
    }
}