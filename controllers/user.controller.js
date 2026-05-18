import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/user.model.js';
import Order from '../models/order.model.js';
import crypto from 'crypto';
import sendEmail from '../middlewares/email.middleware.js';
import createError from '../utils/error.js';
import { createNotifications } from '../utils/notification.js';

export const searchUsers = async (req, res) => {
  try {
    let { q = "", role, page = 1, limit = 10 } = req.query;

    // تنظيف الإدخالات
    q = q.trim();
    page = parseInt(page);
    limit = parseInt(limit);

    // تحقق من وجود كلمة البحث
    if (!q) {
      return res.status(400).json({
        success: false,
        message: "كلمة البحث مطلوبة",
      });
    }

    const searchFilter = {
      $text: { $search: q }
    };

    // role filter
    if (role && ["user", "seller"].includes(role)) {
      searchFilter.role = role;
    }



    // حساب العدد الكلي (لـ pagination)
    const total = await User.countDocuments(searchFilter);

    // البحث بالصفحات مع تحديد البيانات المطلوبة فقط
    const users = await User.find(searchFilter)
      .select("_id firstName lastName email phone role isActive createdAt")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.status(200).json({
      success: true,
      data: users,
      count: users.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      message: "تم العثور على النتائج بنجاح",
    });
  } catch (error) {
    console.error("Error searching users:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء البحث",
      error: error.message,
    });
  }
};

// دالة بديلة للبحث مع فلتر إضافي
export const searchUsersForAdmin = async (req, res) => {
  try {
    const { q, role, isActive } = req.query;

    const searchFilter = {};

    // فلتر البحث
    if (q && q.trim() !== "") {
      searchFilter.$or = [
        { firstName: { $regex: q, $options: 'i' } },
        { lastName: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
        { phone: { $regex: q, $options: 'i' } }
      ];
    }

    // فلتر الدور
    if (role && ['user', 'seller'].includes(role)) {
      searchFilter.role = role;
    }

    // فلتر الحالة النشطة
    if (isActive !== undefined) {
      searchFilter.isActive = isActive === 'true';
    }

    const users = await User.find(searchFilter)
      .select('_id firstName lastName email phone role isActive createdAt')
      .limit(100)
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: users,
      count: users.length
    });

  } catch (error) {
    console.error('Error in searchUsersForAdmin:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في البحث',
      error: error.message
    });
  }
};

// Password reset functionality
export const forgetPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'لم نتمكن من العثور على حساب بهذا البريد الإلكتروني' });
    }

    // Generate verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expirationTime = new Date();
    expirationTime.setMinutes(expirationTime.getMinutes() + 5); // 5 minutes expiration

    // Update user with verification code
    user.passwordResetCode = crypto
      .createHmac("sha256", process.env.JWT_SECRET)
      .update(verificationCode)
      .digest("hex");;
    user.passwordResetCodeExpiresAt = expirationTime;
    user.passwordResetVerified = false;
    await user.save();

    // Send email with verification code
    const emailOptions = {
      email,
      subject: 'طلب إعادة تعيين كلمة المرور - Mirvory',
      html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; text-align: right;">
                    <h2 style="color: #1976D2;">طلب إعادة تعيين كلمة المرور</h2>
                    <p>مرحباً ${user.firstName}،</p>
                    <p>لقد طلبت إعادة تعيين كلمة المرور. استخدم الكود التالي لإعادة تعيين كلمة المرور:</p>
                    <div style="font-size: 24px; font-weight: bold; background: #F5F5F5; padding: 20px; text-align: center; border-radius: 8px;">
                        ${verificationCode}
                    </div>
                    <p>سيتم إلغاء صلاحية هذا الكود بعد 5 دقائق.</p>
                    <p>إذا لم تقم بطلب إعادة تعيين كلمة المرور، يرجى تجاهل هذا البريد.</p>
                </div>
            `
    };

    await sendEmail(emailOptions);

    res.status(200).json({ message: 'تم إرسال كود التحقق إلى بريدك الإلكتروني' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ message: 'حدث خطأ أثناء معالجة طلب إعادة تعيين كلمة المرور' });
  }
};

export const verifyResetCode = async (req, res, next) => {
  try {
    const { code } = req.body;

    const hashedResetCode = crypto
      .createHmac("sha256", process.env.JWT_SECRET)
      .update(req.body.code)
      .digest("hex");
    console.log(hashedResetCode, "hashedResetCode")
    console.log(process.env.JWT_SECRET, "process.env.JWT_SECRET")
    // Find a user with a matching reset code that hasn't expired
    const user = await User.findOne({
      passwordResetCode: hashedResetCode,
      passwordResetCodeExpiresAt: { $gt: Date.now() }
    });
    if (!user) {
      return next(createError("Invalid or expired reset code, please try again", 403));
    }

    user.passwordResetVerified = true;
    await user.save();

    res.status(201).json({ message: "Valid reset code" });
  }
  catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'حدث خطأ أثناء التسجيل' });
  };
}
export const resetPassword = async (req, res, next) => {
  // Retrieve user by email from req.body (user is not authenticated in a reset flow)
  const user = await User.findOne({ email: req.body.email });
  if (!user) {
    return next(new createError('Please Enter Email ', 404))
  }
  if (!user.passwordResetVerified) {
    return next(new createError('Reset code not verified', 400));
  }
  // Update the user's password and clear reset-related fields
  user.password = req.body.newPassword;
  user.passwordResetCode = undefined;
  user.passwordResetCodeExpiresAt = undefined;
  user.passwordResetVerified = undefined;
  await user.save();

  const token = jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE }
  );
  res.status(200).json({ data: user, userToken: token });
};

export const register = async (req, res) => {
  try {
    const { firstName, lastName, email, password, phone, address, role } = req.body;
    console.log(address,'ddddddddssss')
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'هذا البريد الإلكتروني مسجل مسبقاً' });
    }

    // Generate verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expirationTime = new Date();
    expirationTime.setMinutes(expirationTime.getMinutes() + 30);

    const hashedCode = await bcrypt.hash(verificationCode, 10);

    // Create new user
    const user = new User({
      firstName,
      lastName,
      email,
      phone,
      password,
      role: role || "user",  
      address,
      verificationCode: hashedCode,
      verificationCodeExpiresAt: expirationTime
    });
    await user.save();

    // Send verification email (NORMAL)
    await sendEmail({
      email,
      subject: 'Verify Your Email - Mirvory',
      html: `
        <div style="font-family: Arial; max-width: 600px; margin: 0 auto; padding: 20px; text-align: right;">
          <h2 style="color: #1976D2;">مرحباً بك في ميرفوري!</h2>
          <p>شكراً لتسجيلك. لتفعيل حسابك، يرجى إدخال هذا الكود:</p>
          <div style="font-size: 24px; font-weight: bold; background: #F5F5F5; padding: 20px; text-align: center; border-radius: 8px;">
            ${verificationCode}
          </div>
          <p>الكود صالح لمدة 30 دقيقة.</p>
        </div>
      `
    });

    // ================================
    // 🔥 FIRE & FORGET NOTIFICATIONS
    // ================================
    (async () => {
      try {
        const io = req.app.get("io");
        const adminUsers = await User.find({ role: 'admin' });

        await createNotifications({
          io,
          title: '✅ تم تسجيل مستخدم جديد',
          message: `تم تسجيل مستخدم جديد: ${firstName} ${lastName} (${email})`,
          type: 'NEW_REGISTRATION',
          actor: user._id,
          userIds: adminUsers.map(a => a._id.toString()),
          data: { userId: user._id, email },
          link: `/admin/users`,
        });
      } catch (err) {
        console.error("Notification Error:", err);
      }
    })();
    // ============== END FIRE & FORGET ==============

    res.status(201).json({
      message: 'تم التسجيل بنجاح. تم إرسال كود التفعيل إلى بريدك الإلكتروني',
      userId: user._id
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'حدث خطأ أثناء التسجيل' });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // ✅ IMPORTANT: fix payload
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    // ✅ THE FIX: set cookie
    res.cookie("accessToken", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    return res.status(200).json({
      success: true,
      data: {
        user: { id: user._id, role: user.role }
      }
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const verifyEmail = async (req, res) => {
  try {
    console.log(req.body)
    const { email, code } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    // Check if verification code has expired
    if (user.verificationCodeExpiresAt < new Date()) {
      return res.status(400).json({ message: 'انتهت صلاحية كود التفعيل' });
    }

    // Verify the code
    const isValid = await bcrypt.compare(code, user.verificationCode);
    if (!isValid) {
      return res.status(400).json({ message: 'كود التفعيل غير صحيح' });
    }

    // Update user as verified
    await User.updateOne(
      { email },
      {
        $set: {
          isVerified: true,
          verificationCode: null,
          verificationCodeExpiresAt: null
        }
      }
    );

    res.status(200).json({ message: 'تم تفعيل البريد الإلكتروني بنجاح' });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ message: 'حدث خطأ أثناء التفعيل' });
  }
};

export const getUserProfile = async (req, res) => {
  try {
    console.log('im in profile ')
    const user = await User.findById(req.user._id);
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getSellerForAdmin = async (req, res) => {
  try {

    const seller = await User.find({ role: 'seller' })

    res.json(seller);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getUsersForAdmin = async (req, res) => {
  try {
    const users = await User.find({ role: 'user' })
      .select(`
        firstName
        lastName
        email
        phone
        role
        isActive
        isVerified
        address
        createdAt
        updatedAt
      `);

    res.status(200).json(users);

  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
};
export const updateProfile = async (req, res) => {
  try {
    const { firstName, lastName, phone, addresses } = req.body;
    const userId = req.user._id; // Get user ID from authenticated request

    // Find user by ID
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    // Update user fields
    user.firstName = firstName || user.firstName;
    user.lastName = lastName || user.lastName;
    user.phone = phone || user.phone;

    // Save updated user
    const updatedUser = await user.save();

    // Return updated user data (excluding sensitive fields)
    const userData = {
      _id: updatedUser._id,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      email: updatedUser.email,
      phone: updatedUser.phone,
      role: updatedUser.role,
      isVerified: updatedUser.isVerified,
      createdAt: updatedUser.createdAt
    };

    res.status(200).json({
      message: 'تم تحديث الملف الشخصي بنجاح',
      user: userData
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'حدث خطأ أثناء تحديث الملف الشخصي' });
  }
};

//// seller funciton 
// get seller wallet
// Add this to your user controller file
export const getSellerBalance = async (req, res) => {
  try {
    // Get the authenticated user's ID from the request
    const userId = req.user._id;

    // Find the user and explicitly select wallet fields
    const user = await User.findById(userId)
      .select('+wallet +role') // Force include wallet and role
      .lean(); // Convert to plain JS object

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if the user is a seller (note your schema uses 'vendor')
    if (user.role !== 'seller') {
      return res.status(403).json({
        message: 'Only vendors can access balance information'
      });
    }

    // Ensure wallet exists (initialize if missing)
    const wallet = user.wallet || {
      balance: 0,
      pendingBalance: 0,
      currency: 'USD',
      lastTransaction: null
    };

    // Return the wallet information
    res.status(200).json({
      success: true,
      data: {
        availableBalance: wallet.balance,
        pendingBalance: wallet.pendingBalance,
        currency: wallet.currency,
        lastTransaction: wallet.lastTransaction,
        vendorProfile: user.vendorProfile // Include vendor profile if needed
      }
    });

  } catch (error) {
    console.error('Error getting seller balance:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving seller balance',
      error: error.message
    });
  }
};

//resend email verification 
export const resendVerification = async (req, res) => {
  try {
    const { email } = req.body; // Get email from request body for frontend

    console.log('Resend verification request for email:', email);

    // Find user by email (for frontend) or by ID (for authenticated users)
    let user;
    if (email) {
      // For frontend - user is not logged in yet
      user = await User.findOne({ email });
    } else if (req.user?._id) {
      // For authenticated users
      user = await User.findById(req.user._id);
    } else {
      return res.status(400).json({ message: 'البريد الإلكتروني مطلوب' });
    }

    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    if (user.isVerified) {
      return res.status(400).json({ message: 'البريد الإلكتروني مفعل بالفعل' });
    }

    // Generate new verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expirationTime = new Date();
    expirationTime.setMinutes(expirationTime.getMinutes() + 5); // 5 minutes expiration

    // Hash and save verification code
    const hashedCode = await bcrypt.hash(verificationCode, 10);
    user.verificationCode = hashedCode;
    user.verificationCodeExpiresAt = expirationTime;
    await user.save();

    // Send verification email
    const emailOptions = {
      email: user.email,
      subject: 'تفعيل البريد الإلكتروني - Mirvory',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; text-align: right;">
          <h2 style="color: #1976D2;">تفعيل البريد الإلكتروني</h2>
          <p>مرحباً ${user.firstName}،</p>
          <p>استخدم الكود التالي لتفعيل بريدك الإلكتروني:</p>
          <div style="font-size: 24px; font-weight: bold; background: #F5F5F5; padding: 20px; text-align: center; border-radius: 8px;">
            ${verificationCode}
          </div>
          <p>سيتم إلغاء صلاحية هذا الكود بعد 5 دقائق.</p>
        </div>
      `
    };

    await sendEmail(emailOptions);

    res.status(200).json({
      success: true,
      message: 'تم إرسال كود التفعيل إلى بريدك الإلكتروني'
    });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ أثناء إرسال كود التفعيل'
    });
  }
};

export const changeUserPassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // 1) هات اليوزر بالباسورد
    const user = await User.findById(req.user.id).select('+password');
    if (!user) {
      return next(new createError('User not found', 404));
    }

    // 2) تحقق من الباسورد الحالي
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return next(new createError('Current password is incorrect', 400));
    }

    // 3) امنع نفس الباسورد
    const isSame = await bcrypt.compare(newPassword, user.password);
    if (isSame) {
      return next(new createError('New password must be different', 400));
    }

    // ✅ 4) هنا الحل الصح
    user.password = newPassword; // سيب الـ schema يعمل hashing

    user.passwordChangeAt = Date.now();

    await user.save(); // هنا pre-save هيشتغل

    // 5) رجّع response
    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    return next(new createError('Internal server error', 500));
  }
};
export const getMe = async (req, res, next) => {
  try {
    console.log('im in getme')
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized"
      });
    }

    const user = await User.findById(req.user.id).select(
      "-password -verificationCode -passwordResetCode"
    );
    console.log(user, 'jjddk')
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.status(200).json({
      success: true,
      data: user
    });

  } catch (error) {
    console.error("GET_ME_ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

// Refresh token function
export const refreshToken = async (req, res) => {
  try {
    console.log('refreshToken2025')
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({ message: "No refresh token" });
    }

    const decoded = jwt.verify(refreshToken, process.env.REFRESH_SECRET);

    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const newAccessToken = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("accessToken", newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax"
    });

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(401).json({ message: "Invalid refresh token" });
  }
};

// Logout function
export const logout = async (req, res) => {
  try {
    console.log('loggging out ')
    // Clear all authentication cookies
    res.cookie('token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      expires: new Date(0)
    });

    res.cookie('accessToken', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: new Date(0)
    });

    res.cookie('refreshToken', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: new Date(0)
    });

    res.cookie('role', '', {
      expires: new Date(0)
    });

    res.status(200).json({
      success: true,
      message: "Logged out successfully"
    });

  } catch (error) {
    console.error("LOGOUT_ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

// 1. تعديل رصيد البائع الأساسي والمعلق (خاص بالسوبر أدمن)
// تعديل رصيد البائع الأساسي والمعلق (حل مشكلة الـ Validation)
export const updateVendorBalanceByAdmin = async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: "هذه الصلاحية متاحة فقط للسوبر أدمن" });
    }

    const { sellerId, balance, pendingBalance } = req.body;

    // بناء كائن التحديث ديناميكياً لتحديث القيم المرسلة فقط
    const updateFields = {};
    if (balance !== undefined) updateFields['wallet.balance'] = Number(balance);
    if (pendingBalance !== undefined) updateFields['wallet.pendingBalance'] = Number(pendingBalance);

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ success: false, message: "لم يتم إرسال قيم لتحديثها" });
    }

    // استخدام findByIdAndUpdate مع runValidators: false يتخطى أخطاء الـ Cast للحقول الأخرى
    const updatedSeller = await User.findOneAndUpdate(
      { _id: sellerId, role: 'seller' },
      { $set: updateFields },
      { new: true, runValidators: false } // runValidators: false يحل المشكلة تماماً
    );

    if (!updatedSeller) {
      return res.status(404).json({ success: false, message: "لم يتم العثور على البائع" });
    }

    res.status(200).json({
      success: true,
      message: "تم تحديث الرصيد بنجاح",
      data: updatedSeller.wallet
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. توثيق حساب البائع وتغيير حالة القبول الإداري (approvalStatus & trustedSeller)
export const updateVendorStatusByAdmin = async (req, res) => {
  try {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "غير مسموح لك بإجراء هذا التعديل" });
    }

    const { sellerId, trustedSeller, approvalStatus } = req.body;

    // بناء كائن التحديث ديناميكياً
    const updateFields = {};
    if (trustedSeller !== undefined) updateFields['vendorProfile.trustedSeller'] = trustedSeller;
    if (approvalStatus !== undefined) updateFields['vendorProfile.approvalStatus'] = approvalStatus;

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ success: false, message: "لم يتم إرسال قيم لتحديثها" });
    }

    // التحديث المباشر وتخطي التحقق من الحقول الأخرى (مثل الـ addresses)
    const updatedSeller = await User.findOneAndUpdate(
      { _id: sellerId, role: 'seller' },
      { $set: updateFields },
      { new: true, runValidators: false }
    );

    if (!updatedSeller) {
      return res.status(404).json({ success: false, message: "لم يتم العثور على البائع" });
    }

    res.status(200).json({
      success: true,
      message: "تم تحديث حالة البائع بنجاح",
      data: updatedSeller.vendorProfile
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
// 3. تعطيل أو تفعيل حساب البائع (isActive)
export const toggleUserActiveStatus = async (req, res) => {
  try {
    // 1. التحقق من الصلاحيات الإدارية
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "غير مسموح لك بإجراء هذا التعديل" });
    }

    const { userId, isActive } = req.body;

    if (isActive === undefined) {
      return res.status(400).json({ success: false, message: "حالة التفعيل المطلوبة غير محددة" });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: { isActive: isActive } },
      {
        new: true,
        runValidators: false, 
        validateModifiedOnly: false
      }
    ).select("isActive");

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "المستخدم غير موجود" });
    }

    res.status(200).json({
      success: true,
      message: updatedUser.isActive ? "تم تفعيل الحساب بنجاح" : "تم تعطيل الحساب بنجاح",
      data: { isActive: updatedUser.isActive }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// الحذف النهائي والدائم للمستخدم أو البائع من قاعدة البيانات
export const permanentlyDeleteUser = async (req, res) => {
  try {
    // تأمين حرج: التأكد أن القائم بالإجراء هو السوبر أدمن فقط
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: "عذراً، صلاحية الحذف النهائي الدائم مقتصرة على السوبر أدمن فقط"
      });
    }

    const { userId } = req.body; // أو req.params حسب تصميم الـ routes لديك

    if (!userId) {
      return res.status(400).json({ success: false, message: "معرف المستخدم مطلوب" });
    }

    // تنفيذ الحذف الصارم والنهائي (Hard Delete)
    const deletedUser = await User.findByIdAndDelete(userId);

    if (!deletedUser) {
      return res.status(404).json({ success: false, message: "المستخدم غير موجود بالفعل أو تم حذفه مسبقاً" });
    }

    res.status(200).json({
      success: true,
      message: "تم حذف الحساب والبيانات التابعة له نهائياً من قاعدة البيانات"
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};