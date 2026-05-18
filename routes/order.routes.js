import express from 'express';
import { getAdminOrders, getSellerOrders,
     orderComplete, getVendorEarnings,
      updatePayment, cashingOrder,
      createOrder, confirmPreparation, confirmItemPreparation,
      createOrderFilterObj, updateDeliveryStatus,
      getUserOrderById, getUserOrders, printInvoice } from '../controllers/order.controller.js';
import { isAdmin, isSeller, protect } from '../middlewares/auth.js';

const router = express.Router();
router.use(protect);

router.post('/complete',isAdmin, orderComplete); 
router.get('/', getUserOrders);
router.get('/admin/all', isAdmin, getAdminOrders);
router.get('/seller', isSeller, createOrderFilterObj, getSellerOrders);
router.get('/:id', getUserOrderById);
router.get('/:id/invoice', printInvoice);
// router.get('/vendor/:vendorId/earnings', isSeller, getVendorEarnings);
router.patch('/updateDelivery', isAdmin, updateDeliveryStatus);
router.patch('/prepared/:id', isSeller, confirmPreparation);
router.patch('/prepared/:orderId/item/:itemId', isSeller, confirmItemPreparation);
// router.post('/update-payment', updatePayment);
// payment
// router.get("/check-out-session/:cartId", verifyToken, checkOutSession);

router.post("/", createOrder);

// router.patch("/pay/method", verifyToken, updatedOrderPaymentMethod);
export default router;
