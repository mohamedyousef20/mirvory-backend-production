import userRoutes from './user.routes.js';
import productRoutes from './product.routes.js';
import orderRoutes from './order.routes.js';
import notificationRoutes from './notification.routes.js';
import returnRoutes from './return.routes.js';
import pickupRoutes from './pickup.routes.js';
import cartRoutes from './cart.routes.js';
import categoryRoutes from './category.routes.js';
import announcementRoutes from './announcement.routes.js';
import wishlistRoutes from './wishlist.routes.js';
import couponRoutes from './coupon.routes.js';
// import addressesRoutes from './address.routes.js';
import dashboardRoutes from './dashboard.routes.js';
// import analyticsRoutes from './analytics.routes.js';
// import transactionsRoutes from './transactions.routes.js';
// import superAdminRoutes from './superAdmin.routes.js';
// import adminFinancialRoutes from './adminFinancial.routes.js';
// import auditLogRoutes from './auditLog.routes.js';

const mountRoutes = (app) => {

    app.use('/api/products', productRoutes);
    app.use('/api/users', userRoutes);
    app.use('/api/carts', cartRoutes);
    app.use('/api/orders', orderRoutes);
    app.use('/api/notifications', notificationRoutes);
    app.use('/api/returns', returnRoutes);
    app.use('/api/pickup', pickupRoutes);
    app.use('/api/categories', categoryRoutes);
    app.use('/api/announcements', announcementRoutes);
    app.use('/api/wishlist', wishlistRoutes);
    app.use('/api/coupons', couponRoutes);
    // app.use('/api/addresses', addressesRoutes);
    app.use('/api/dashboard', dashboardRoutes);
//     app.use('/api/analytics', analyticsRoutes);
//     app.use('/api/transactions', transactionsRoutes);
//     app.use('/api/admin/super', superAdminRoutes);
//     app.use('/api/admin/financial', adminFinancialRoutes);
//     app.use('/api/admin/audit', auditLogRoutes);

}

export default mountRoutes