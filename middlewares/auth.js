import jwt from 'jsonwebtoken';
import User from '../models/user.model.js';

// 1. حماية المسار والتأكد من وجود التوكن
export const protect = async (req, res, next) => {
  try {
    let token;
    if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    } else if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ message: 'الرجاء تسجيل الدخول، الوصول غير مصرح' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password'); // جلب البيانات بدون كلمة المرور

    if (!req.user) {
      return res.status(401).json({ message: 'المستخدم غير موجود' });
    }

    next();
  } catch (error) {
    return res.status(401).json({ message: 'توكن غير صالح أو منتهي الصلاحية' });
  }
};

// صلاحيات السوبر أدمن فقط - لا يمكن للأدمن العادي الدخول هنا
export const isSuperAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'super_admin') {
    next();
  } else {
    res.status(403).json({
      message: 'الوصول مرفوض: هذا المسار مخصص للمسؤول الأعلى للنظام فقط (Super Admin)'
    });
  }
};
// 2. صلاحيات الأدمن (Super Admin و Admin)
export const isAdmin = (req, res, next) => {
  const authorizedRoles = ['admin', 'super_admin'];

  if (req.user && authorizedRoles.includes(req.user.role)) {
    next();
  } else {
    res.status(403).json({ message: 'مطلوب صلاحيات المسؤول (Admin/Super Admin)' });
  }
};

// 3. صلاحيات البائع (Super Admin و Admin و Seller)
export const isSeller = (req, res, next) => {
  const authorizedRoles = ['seller', 'admin', 'super_admin'];

  if (req.user && authorizedRoles.includes(req.user.role)) {
    next();
  } else {
    res.status(403).json({ message: 'مطلوب صلاحيات البائع أو المسؤول' });
  }
};

// 4. صلاحيات المشتري/المستخدم العادي (الجميع عدا غير المفعلين)
export const isUser = (req, res, next) => {
  // مسموح للكل الدخول طالما لديهم حساب، لكن بشرط التفعيل للمستخدم العادي
  const authorizedRoles = ['user', 'seller', 'admin', 'super_admin'];

  if (req.user && authorizedRoles.includes(req.user.role)) {
    // التحقق من التفعيل فقط للمستخدم العادي (User) والبائع (Seller) 
    // الأدمن والمسؤول غالباً ما يتم تجاوز هذا القيد لهم
    if (req.user.role === 'user' && !req.user.isVerified) {
      return res.status(403).json({
        message: 'يرجى تفعيل البريد الإلكتروني أولاً للوصول إلى هذه الخدمة'
      });
    }
    next();
  } else {
    res.status(403).json({ message: 'مطلوب صلاحيات المستخدم' });
  }
};