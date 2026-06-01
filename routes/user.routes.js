import express from 'express';
import { register, login, verifyEmail, forgetPassword, verifyResetCode, resetPassword, updateProfile, getSellerBalance, getSellerForAdmin, getUsersForAdmin, searchUsersForAdmin, searchUsers, resendVerification, changeUserPassword, getMe, refreshToken, logout, updateVendorBalanceByAdmin, updateVendorStatusByAdmin, toggleUserActiveStatus, permanentlyDeleteUser } from '../controllers/user.controller.js';
import { getSellerOrders } from '../controllers/order.controller.js';
import { protect, isSeller, isAdmin } from '../middlewares/auth.js';
import { registerUserValid } from '../validations/user/registerUserValid.js'
import { loginUserValid } from '../validations/user/loginUserValid.js';
import { changePasswordValid, forgotPasswordValid, resendValid, resetPasswordValid, verifyEmailValid, verifyResetCodeValid } from '../validations/user/authValid.js';
import { updateUserValid } from '../validations/user/updateUserValid.js';
import { paginate } from '../middlewares/pagination.js';
import { sort } from '../middlewares/sort.js';
import { search, buildFilter, commonFilters } from '../middlewares/search.js';

const router = express.Router();

router.post('/register',registerUserValid,register);
router.post('/login', loginUserValid, login);
router.post('/auth/login', loginUserValid, login);
router.post('/refresh-token', refreshToken);
router.post('/logout', logout);
router.get('/test-auth', protect, (req, res) => {
  res.json({ 
    success: true, 
    message: 'Authentication working',
    user: req.user 
  });
});
router.post('/verify-email', verifyEmailValid, verifyEmail);
router.post('/forgot-password', forgotPasswordValid, forgetPassword);
router.post('/verify-reset-code', verifyResetCodeValid, verifyResetCode);
router.post('/reset-password', resetPasswordValid, resetPassword);
router.post('/resend-email', resendValid, resendVerification);

router.use(protect);
router.get('/me', getMe);
router.patch('/profile', updateUserValid,updateProfile);
router.patch('/change-password', changePasswordValid,changeUserPassword);
router.get('/seller/orders', isSeller, paginate(12), sort({ createdAt: -1 }), getSellerOrders);
router.get('/seller/balance', isSeller, getSellerBalance);
router.get('/admin/sellers', isAdmin, paginate(12), sort({ createdAt: -1 }), buildFilter(commonFilters.user), search(['firstName', 'lastName', 'email']), getSellerForAdmin);
router.get('/admin/users', isAdmin, paginate(12), sort({ createdAt: -1 }), buildFilter(commonFilters.user), search(['firstName', 'lastName', 'email']), getUsersForAdmin);
router.get('/search', isAdmin, paginate(12), sort({ createdAt: -1 }), search(['firstName', 'lastName', 'email']), searchUsers);
router.get('/admin/search', isAdmin, paginate(12), sort({ createdAt: -1 }), search(['firstName', 'lastName', 'email']), searchUsersForAdmin);

router.patch('/admin/vendor/balance',isAdmin, updateVendorBalanceByAdmin);

// 2. Update Vendor Status & Trust (Allowed for admin and super_admin)
router.patch('/admin/vendor/status',isAdmin, updateVendorStatusByAdmin);

// 3. Toggle User Active/Inactive Status (Allowed for admin and super_admin)
router.patch('/admin/toggle-active',isAdmin, toggleUserActiveStatus);

router.delete('/admin/permanently-delete', isAdmin, permanentlyDeleteUser);
export default router;
