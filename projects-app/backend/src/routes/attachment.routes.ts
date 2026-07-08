import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  uploadAttachment,
  getAttachments,
  getAttachmentById,
  deleteAttachment,
} from '../controllers/attachment.controller';

const router = Router();
router.use(authenticate);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/temp');
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

router.post('/', upload.single('file'), uploadAttachment);
router.get('/project/:projectId', getAttachments);
router.get('/:id', getAttachmentById);
router.delete('/:id', deleteAttachment);

export default router;
