import nodemailer from 'nodemailer';

// Reuse transporter across calls (avoid recreating on every request)
let transporter = null;

const getTransporter = () => {
    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: parseInt(process.env.EMAIL_PORT, 10) || 465,
            secure: (process.env.EMAIL_PORT || '465') === '465',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSWORD,
            },
        });
    }
    return transporter;
};

const sendEmail = async (options) => {
    try {
        const mailer = getTransporter();

        const mailOptions = {
            from: `Mirvory <${process.env.EMAIL_USER || 'noreply@mirvory.com'}>`,
            to: options.email,
            subject: options.subject,
            ...(options.html ? { html: options.html } : { text: options.message }),
        };

        await mailer.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Error sending email:', error.message);
        return false;
    }
};

export default sendEmail;
