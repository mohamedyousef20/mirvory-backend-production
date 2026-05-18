import nodemailer from 'nodemailer';

const sendEmail = async (options) => {
    try {
        // Initialize transporter only when needed
        const transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: process.env.EMAIL_PORT,
            secure: true,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSWORD
            }
        });

        console.log("Email configuration loaded:");
        console.log("Host:", process.env.EMAIL_HOST);
        console.log("Port:", process.env.EMAIL_PORT);
        console.log("User:", process.env.EMAIL_USER);
        console.log("Password:", process.env.EMAIL_PASSWORD);

        const mailOptions = {
            from: 'Mirvory Support Team <ahlawy55555@gmail.com>',
            to: options.email,
            subject: options.subject,
            ...(options.html ? { html: options.html } : { text: options.message })
        };

        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Error sending email:', error);
        return false;
    }
};

export default sendEmail