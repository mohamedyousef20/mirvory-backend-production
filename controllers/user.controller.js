import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import crypto from 'crypto';
import User from '../models/user.model.js';
import sendEmail from '../middlewares/email.middleware.js';
import createError from '../utils/error.js';
import { createNotifications } from '../utils/notification.js';
import { formatPaginationResponse } from '../middlewares/pagination.js';

// ==========================================
// 🛠 HELPER FUNCTIONS
// ==========================================
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// ==========================================
// 🔍 SEARCH & LISTING
// ==========================================
export const searchUsers = async (req, res, next) => {
  try {
    const { page, limit, skip } = req.pagination;
    const sortObj = req.sort || { createdAt: -1 };
    const filterObj = req.filter || {};
    const searchFilter = req.searchFilter || {};

    const filter = { ...filterObj, ...searchFilter };

    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .select("_id firstName lastName email phone role isActive isVerified createdAt")
      .sort(sortObj)
      .skip(skip)
      .limit(limit)
      .lean();

    res.status(200).json(formatPaginationResponse(users, total, req.pagination));
  } catch (error) {
    console.error("Error searching users:", error);
    next(new createError("حدث خطأ أثناء البحث", 500));
  }
};

export const searchUsersForAdmin = async (req, res, next) => {
  try {
    const { page, limit, skip } = req.pagination;
    const sortObj = req.sort || { createdAt: -1 };
    const filterObj = req.filter || {};
    const searchFilter = req.searchFilter || {};

    const filter = { ...filterObj, ...searchFilter };

    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .select("_id firstName lastName email phone role isActive isVerified createdAt")
      .sort(sortObj)
      .skip(skip)
      .limit(limit)
      .lean();

    res.status(200).json(formatPaginationResponse(users, total, req.pagination));
  } catch (error) {
    console.error("Error searching users for admin:", error);
    next(new createError("حدث خطأ أثناء البحث", 500));
  }
};

export const getSellerForAdmin = async (req, res, next) => {
  try {
    const { page, limit, skip } = req.pagination;
    const sortObj = req.sort || { createdAt: -1 };
    const filterObj = req.filter || {};
    const searchFilter = req.searchFilter || {};

    const filter = { role: 'seller', ...filterObj, ...searchFilter };

    const total = await User.countDocuments(filter);
    const sellers = await User.find(filter)
      .sort(sortObj)
      .skip(skip)
      .limit(limit)
      .lean();
console.log(sellers,'12345688')
    res.status(200).json(formatPaginationResponse(sellers, total, req.pagination));
  } catch (error) {
    next(new createError(error.message, 500));
  }
};

export const getUsersForAdmin = async (req, res, next) => {
  try {
    const { page, limit, skip } = req.pagination;
    const sortObj = req.sort || { createdAt: -1 };
    const filterObj = req.filter || {};
    const searchFilter = req.searchFilter || {};

    const filter = {
      ...filterObj,
      ...searchFilter,
      role: 'user'
    };
    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .select('firstName lastName email phone role isActive isVerified address createdAt updatedAt')
      .sort(sortObj)
      .skip(skip)
      .limit(limit)
      .lean();
    console.log(total,'user147')
    res.status(200).json(formatPaginationResponse(users, total, req.pagination));
  } catch (error) {
    next(new createError(error.message, 500));
  }
};

// ==========================================
// 🔐 AUTHENTICATION & PASSWORD MANAGEMENT
// ==========================================
export const register = async (req, res, next) => {
  try {
    const { firstName, lastName, email, password, phone, address, role, vendorProfile } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) return next(new createError("هذا البريد الإلكتروني مسجل مسبقاً", 400));

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedCode = await bcrypt.hash(verificationCode, 10);

    const user = new User({
      firstName, 
      lastName, 
      email, 
      phone,
       password,
      role: role || "user",
      address,
      verificationCode: hashedCode,
      vendorProfile: role === "seller" ? vendorProfile : undefined,
      verificationCodeExpiresAt: Date.now() + 30 * 60 * 1000
    });

    await user.save();

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

    // 🔔 NOTIFICATION: Admin Alert for new registration
    (async () => {
      try {
        const io = req.app.get("io");
        const adminUsers = await User.find({ role: 'admin' }).select('_id');
        await createNotifications({
          io,
          title: '✅ مستخدم جديد',
          message: `تم تسجيل مستخدم جديد: ${firstName} ${lastName} (${email})`,
          type: 'USER_REGISTERED',
          actor: user._id,
          userId: adminUsers.map(a => a._id.toString()),
          data: { userId: user._id, email },
          link: `/admin/users`,
        });
      } catch (err) {
        console.error("Notification Error:", err);
      }
    })();

    res.status(201).json({
      success: true,
      message: 'تم التسجيل بنجاح. تم إرسال كود التفعيل إلى بريدك الإلكتروني',
      userId: user._id
    });
  } catch (error) {
    console.error('Registration error:', error);
    next(new createError("حدث خطأ أثناء التسجيل", 500));
  }
};

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return next(new createError("البريد وكلمة المرور مطلوبة", 400));
    console.log(password,'147ss')
    const user = await User.findOne({ email }).select('+password');
    if (!user) return next(new createError("بيانات الدخول غير صحيحة", 401));
    console.log(user, '147sss')

    // 🚨 SECURITY: Prevent login for suspended or unverified users
    if (!user.isActive) return next(new createError("هذا الحساب موقوف، يرجى التواصل مع الإدارة", 403));
    // if (!user.isVerified) return next(new createError("يرجى تفعيل بريدك الإلكتروني أولاً", 403));

    const isMatch = await bcrypt.compare(password, user.password);
    console.log(isMatch, '147ssss')

    if (!isMatch) return next(new createError("بيانات الدخول غير صحيحة", 401));

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || "1d" }
    );

    const refreshToken = jwt.sign(
      { id: user._id },
      process.env.REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("accessToken", token, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 24 * 60 * 60 * 1000
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.status(200).json({ success: true, data: { user: { id: user._id, role: user.role } } });
  } catch (error) {
    console.log('Login Error ', error)
    next(new createError(error.message, 500));
  }
};

export const logout = async (req, res, next) => {
  try {
    res.cookie('token', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', expires: new Date(0) });
    res.cookie('accessToken', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', expires: new Date(0) });
    res.cookie('refreshToken', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', expires: new Date(0) });
    res.cookie('role', '', { expires: new Date(0) });

    res.status(200).json({ success: true, message: "تم تسجيل الخروج بنجاح" });
  } catch (error) {
    console.error("LOGOUT_ERROR:", error);
    next(new createError("خطأ في الخادم", 500));
  }
};

export const refreshToken = async (req, res, next) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) return next(new createError("No refresh token", 401));

    const decoded = jwt.verify(refreshToken, process.env.REFRESH_SECRET);
    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) return next(new createError("المستخدم غير موجود أو موقوف", 401));

    const newAccessToken = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    res.cookie("accessToken", newAccessToken, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 24 * 60 * 60 * 1000
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    next(new createError("Invalid refresh token", 401));
  }
};

export const verifyEmail = async (req, res, next) => {
  try {
    const { email, code } = req.body;
    const user = await User.findOne({ email });

    if (!user) return next(new createError("المستخدم غير موجود", 404));
    if (user.isVerified) return next(new createError("الحساب مفعل بالفعل", 400));
    if (user.verificationCodeExpiresAt < Date.now()) return next(new createError("كود منتهي الصلاحية", 400));

    const isValid = await bcrypt.compare(code, user.verificationCode);
    if (!isValid) return next(new createError("كود التفعيل غير صحيح", 400));

    user.isVerified = true;
    user.verificationCode = undefined;
    user.verificationCodeExpiresAt = undefined;
    await user.save();

    // 🔔 NOTIFICATION: Welcome User
    (async () => {
      try {
        const io = req.app.get("io");
        await createNotifications({
          io,
          title: '🎉 مرحباً بك في ميرفوري!',
          message: 'تم تفعيل حسابك بنجاح. نتمنى لك تسوقاً ممتعاً.',
          type: 'USER_VERIFIED',
          actor: user._id,
          userId: [user._id.toString()],
          data: {},
          link: '/',
        });
      } catch (err) {
        console.error("Notification Error:", err);
      }
    })();

    res.status(200).json({ success: true, message: 'تم تفعيل البريد الإلكتروني بنجاح' });
  } catch (error) {
    console.error('Verification error:', error);
    next(new createError("حدث خطأ أثناء التفعيل", 500));
  }
};

export const resendVerification = async (req, res, next) => {
  try {
    const { email } = req.body;
    let user = email ? await User.findOne({ email }) : (req.user?._id ? await User.findById(req.user._id) : null);
console.log(user,'123456s')
    if (!user) return next(new createError("المستخدم غير موجود", 404));
    if (user.isVerified) return next(new createError("البريد الإلكتروني مفعل بالفعل", 400));

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedCode = await bcrypt.hash(verificationCode, 10);

    user.verificationCode = hashedCode;
    user.verificationCodeExpiresAt = Date.now() + 5 * 60 * 1000;
    await user.save({ validateModifiedOnly: true });

    await sendEmail({
      email: user.email,
      subject: 'تفعيل البريد الإلكتروني - Mirvory',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; text-align: right;">
          <h2 style="color: #1976D2;">تفعيل البريد الإلكتروني</h2>
          <p>مرحباً ${user.firstName}،</p>
          <div style="font-size: 24px; font-weight: bold; background: #F5F5F5; padding: 20px; text-align: center; border-radius: 8px;">
            ${verificationCode}
          </div>
          <p>سيتم إلغاء صلاحية هذا الكود بعد 5 دقائق.</p>
        </div>
      `
    });

    res.status(200).json({ success: true, message: 'تم إرسال كود التفعيل إلى بريدك الإلكتروني' });
  } catch (error) {
    console.error('Resend verification error:', error);
    next(new createError("حدث خطأ أثناء إرسال كود التفعيل", 500));
  }
};

export const forgetPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return next(new createError("البريد الإلكتروني مطلوب", 400));

    const user = await User.findOne({ email });
    if (!user) return next(new createError("لم نتمكن من العثور على حساب بهذا البريد", 404));

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedCode = crypto.createHmac("sha256", process.env.JWT_SECRET).update(verificationCode).digest("hex");

    user.passwordResetCode = hashedCode;
    user.passwordResetCodeExpiresAt = Date.now() + 5 * 60 * 1000;
    await user.save({ validateModifiedOnly: true });

    await sendEmail({
      email,
      subject: 'طلب إعادة تعيين كلمة المرور - Mirvory',
      html: `
        <div style="font-family: Arial, sans-serif; text-align: right;">
            <h2>طلب إعادة تعيين كلمة المرور</h2>
            <p>مرحباً ${user.firstName}،</p>
            <div style="font-size: 24px; font-weight: bold; padding: 20px;">${verificationCode}</div>
            <p>صالح لمدة 5 دقائق.</p>
        </div>
      `
    });

    res.status(200).json({ success: true, message: 'تم إرسال كود التحقق إلى بريدك الإلكتروني' });
  } catch (error) {
    console.error('Password reset error:', error);
    next(new createError('حدث خطأ أثناء المعالجة', 500));
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
      return next(new createError("Invalid or expired reset code, please try again", 403));
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

export const changeUserPassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user.id).select('+password');
    if (!user) return next(new createError("المستخدم غير موجود", 404));

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return next(new createError("كلمة المرور الحالية غير صحيحة", 400));

    const isSame = await bcrypt.compare(newPassword, user.password);
    if (isSame) return next(new createError("يجب أن تكون كلمة المرور جديدة ومختلفة", 400));

    user.password = newPassword;
    user.passwordChangeAt = Date.now();
    await user.save();

    res.status(200).json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (error) {
    console.error('Change password error:', error);
    next(new createError("خطأ في الخادم", 500));
  }
};

// ==========================================
// 👤 USER PROFILE & DATA
// ==========================================
export const getMe = async (req, res, next) => {
  try {
    if (!req.user?.id) return next(new createError("غير مصرح", 401));

    const user = await User.findById(req.user.id).select("-password -verificationCode -passwordResetCode").lean();
    if (!user) return next(new createError("المستخدم غير موجود", 404));

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    console.error("GET_ME_ERROR:", error);
    next(new createError("خطأ في الخادم", 500));
  }
};

export const updateProfile = async (req, res, next) => {
  try {
    const { firstName, lastName, phone } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) return next(new createError("المستخدم غير موجود", 404));

    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (phone) user.phone = phone;

    const updatedUser = await user.save();

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

    res.status(200).json({ success: true, message: 'تم تحديث الملف الشخصي بنجاح', user: userData });
  } catch (error) {
    console.error('Update profile error:', error);
    next(new createError("حدث خطأ أثناء تحديث الملف الشخصي", 500));
  }
};

export const getSellerBalance = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId).select('+wallet +role').lean();
    if (!user) return next(new createError("المستخدم غير موجود", 404));

    if (user.role !== 'seller') return next(new createError("فقط البائعين يمكنهم الوصول لبيانات الرصيد", 403));

    const wallet = user.wallet || { balance: 0, pendingBalance: 0, currency: 'EGP', lastTransaction: null };

    res.status(200).json({
      success: true,
      data: {
        availableBalance: wallet.balance,
        pendingBalance: wallet.pendingBalance,
        currency: wallet.currency,
        lastTransaction: wallet.lastTransaction,
        vendorProfile: user.vendorProfile
      }
    });
  } catch (error) {
    console.error('Error getting seller balance:', error);
    next(new createError("حدث خطأ أثناء جلب الرصيد", 500));
  }
};

// ==========================================
// 🛡 ADMIN / SUPER ADMIN CONTROLS
// ==========================================
export const updateVendorBalanceByAdmin = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return next(new createError("هذه الصلاحية متاحة فقط للسوبر أدمن", 403));

    const { sellerId, balance, pendingBalance } = req.body;
    if (!isValidObjectId(sellerId)) return next(new createError("معرف البائع غير صالح", 400));

    const seller = await User.findOne({ _id: sellerId, role: 'seller' });
    if (!seller) return next(new createError("لم يتم العثور على البائع", 404));

    if (balance !== undefined) seller.wallet.balance = Number(balance);
    if (pendingBalance !== undefined) seller.wallet.pendingBalance = Number(pendingBalance);

    // Save with validateModifiedOnly to respect full validation rules safely
    await seller.save({ validateModifiedOnly: true });

    // 🔔 NOTIFICATION: Wallet Update for Seller
    (async () => {
      try {
        const io = req.app.get("io");
        await createNotifications({
          io,
          title: '💰 تحديث المحفظة',
          message: 'تم تحديث رصيد محفظتك من قبل الإدارة.',
          type: 'WALLET_UPDATED',
          actor: req.user.id,
          userId: [seller._id.toString()],
          data: { balance: seller.wallet.balance },
          link: '/seller/wallet',
        });
      } catch (err) {
        console.error("Notification Error:", err);
      }
    })();

    res.status(200).json({ success: true, message: "تم تحديث الرصيد بنجاح", data: seller.wallet });
  } catch (error) {
    next(new createError(error.message, 500));
  }
};

export const updateVendorStatusByAdmin = async (req, res, next) => {
  try {
    if (!['admin', 'super_admin'].includes(req.user.role)) return next(new createError("غير مسموح لك بإجراء هذا التعديل", 403));

    const { sellerId, trustedSeller, approvalStatus } = req.body;
    if (!isValidObjectId(sellerId)) return next(new createError("معرف البائع غير صالح", 400));

    const seller = await User.findOne({ _id: sellerId, role: 'seller' });
    if (!seller) return next(new createError("لم يتم العثور على البائع", 404));

    if (trustedSeller !== undefined) seller.vendorProfile.trustedSeller = trustedSeller;
    if (approvalStatus !== undefined) seller.vendorProfile.approvalStatus = approvalStatus;

    await seller.save({ validateModifiedOnly: true });

    // 🔔 NOTIFICATION: Vendor Status Update
    (async () => {
      try {
        const io = req.app.get("io");
        const statusMsg = approvalStatus === 'approved'
          ? 'تهانينا! تمت الموافقة على حساب البائع الخاص بك.'
          : 'تم تحديث حالة حساب البائع الخاص بك بواسطة الإدارة.';

        await createNotifications({
          io,
          title: '🏪 حالة المتجر',
          message: statusMsg,
          type: 'CUSTOM',
          actor: req.user.id,
          userId: [seller._id.toString()],
          data: { approvalStatus },
          link: '/seller/dashboard',
        });
      } catch (err) {
        console.error("Notification Error:", err);
      }
    })();

    res.status(200).json({ success: true, message: "تم تحديث حالة البائع بنجاح", data: seller.vendorProfile });
  } catch (error) {
    next(new createError(error.message, 500));
  }
};

export const toggleUserActiveStatus = async (req, res, next) => {
  try {
    if (!['admin', 'super_admin'].includes(req.user.role)) return next(new createError("غير مسموح لك بإجراء هذا التعديل", 403));

    const { userId, isActive } = req.body;
    if (!isValidObjectId(userId)) return next(new createError("معرف المستخدم غير صالح", 400));
    if (typeof isActive !== 'boolean') return next(new createError("حالة التفعيل غير محددة أو غير صالحة", 400));

    const user = await User.findById(userId);
    if (!user) return next(new createError("المستخدم غير موجود", 404));

    user.isActive = isActive;
    await user.save({ validateModifiedOnly: true });

    // 🔔 NOTIFICATION: Account Suspension/Activation
    (async () => {
      try {
        const io = req.app.get("io");
        const msg = isActive ? 'تم إعادة تفعيل حسابك بنجاح.' : 'تم إيقاف حسابك مؤقتاً من قبل الإدارة لمخالفة الشروط.';
        const type = isActive ? 'CUSTOM' : 'USER_SUSPENDED';

        await createNotifications({
          io,
          title: isActive ? '✅ تفعيل الحساب' : '⛔ إيقاف الحساب',
          message: msg,
          type: type,
          actor: req.user.id,
          userId: [user._id.toString()],
          data: { isActive },
          link: '/',
        });
      } catch (err) {
        console.error("Notification Error:", err);
      }
    })();

    res.status(200).json({ success: true, message: isActive ? "تم تفعيل الحساب بنجاح" : "تم تعطيل الحساب بنجاح", data: { isActive: user.isActive } });
  } catch (error) {
    next(new createError(error.message, 500));
  }
};

export const permanentlyDeleteUser = async (req, res, next) => {
  try {
    if (req.user.role !== 'super_admin') {
      return next(new createError("عذراً، صلاحية الحذف النهائي مقتصرة على السوبر أدمن فقط", 403));
    }

    const { userId } = req.body;
    if (!isValidObjectId(userId)) return next(new createError("معرف المستخدم مطلوب وغير صالح", 400));

    // تم التحويل للحذف المنطقي Soft Delete لحماية استقرار قواعد البيانات المالية والتاريخية
    const user = await User.findById(userId);
    if (!user) return next(new createError("المستخدم غير موجود بالفعل", 404));

    user.isActive = false;
    // user.isDeleted = true; // يمكن إضافة هذا الحقل للموديل مستقبلاً للمسح المنطقي النهائي

    await user.save({ validateModifiedOnly: true });

    res.status(200).json({ success: true, message: "تم إيقاف الحساب منطقياً للحفاظ على سلامة النظام والفواتير المرتبطة" });
  } catch (error) {
    next(new createError(error.message, 500));
  }
};