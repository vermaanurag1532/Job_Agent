import express from 'express';
import multer from 'multer';
import { emailController } from '../controllers/emailController.js';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });

// Routes
router.post('/send-email', upload.single('resume'), emailController.sendEmail);

export default router;