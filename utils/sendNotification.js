import io from 'socket.io-client';

const socket = io('http://localhost:5000');

export const sendNotification = async (userId, message) => {
  try {
    socket.emit('notification', { userId, message });
  } catch (error) {
    console.error('خطأ في إرسال الإشعار:', error);
  }
};
