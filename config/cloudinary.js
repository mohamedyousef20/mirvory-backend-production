import { v2 as cloudinary } from 'cloudinary';

console.log('Cloudinary configuration attempt:', {
    cloud_name: 'dkmrrisek' ? 'set' : 'NOT SET',
    api_key: "579668224964754" ? 'set' : 'NOT SET',
    api_secret: 'iaIceTjCo9IZ4dX7xb94Klz37VU' ? 'set' : 'NOT SET'
});

try {
    cloudinary.config({
        cloud_name: 'dkmrrisek',
        api_key: "579668224964754",
        api_secret: 'iaIceTjCo9IZ4dX7xb94Klz37VU',
        secure: true
    });
    console.log('Cloudinary configuration successful');
} catch (error) {
    console.error('Cloudinary configuration error:', error);
    throw error;
}

export default cloudinary;