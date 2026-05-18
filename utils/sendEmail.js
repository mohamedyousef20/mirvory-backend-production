import nodemailer from 'nodemailer';

export const sendVerificationEmail = async (email, verificationLink) => {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'تفعيل حسابك',
      html: `
        <h2>مرحباً بك في متجرنا</h2>
        <p>لتفعيل حسابك، اضغط على الرابط التالي:</p>
        <a href="${verificationLink}">${verificationLink}</a>
      `
    });
  } catch (error) {
    console.error('خطأ في إرسال البريد:', error);
    throw error;
  }
};
