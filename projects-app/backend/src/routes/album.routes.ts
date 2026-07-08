import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getAlbums,
  createAlbum,
  updateAlbum,
  deleteAlbum,
  movePhotosToAlbum,
} from '../controllers/album.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Album routes
router.get('/project/:projectId', getAlbums);
router.post('/project/:projectId', createAlbum);
router.put('/:id', updateAlbum);
router.delete('/:id', deleteAlbum);
router.post('/:albumId/photos', movePhotosToAlbum);

export default router;
