import multer from 'multer';

// Configure multer to store files in memory
// This allows us to process the buffer before uploading to Cloudinary
const storage = multer.memoryStorage();

// File filter to accept only images
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

// Configure multer
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 20 // Maximum 20 files
  }
});

export const uploadImages = upload.array('images', 20);
export const uploadSingleImage = upload.single('image');
export const uploadFields = upload.fields([
  { name: 'images', maxCount: 20 },
  { name: 'colorImages', maxCount: 20 }
]);
