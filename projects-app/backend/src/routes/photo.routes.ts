import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  uploadPhoto,
  getPhotos,
  getPhotoById,
  deletePhoto,
} from '../controllers/photo.controller';

const router = Router();
router.use(authenticate);

// Configuration multer pour upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/temp');
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const fileFilter = (req: any, file: any, cb: any) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images are allowed.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

router.post('/', upload.single('photo'), uploadPhoto);
router.get('/project/:projectId', getPhotos);
router.get('/:id', getPhotoById);
router.delete('/:id', deletePhoto);

export default router;
