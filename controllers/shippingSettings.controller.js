import ShippingSettings from '../models/shippingSettings.model.js';
import createError from '../utils/error.js';

// Get shipping settings (public)
export const getShippingSettings = async (req, res, next) => {
  try {
    const settings = await ShippingSettings.getSettings();
    res.status(200).json(settings);
  } catch (error) {
    next(error);
  }
};

// Update shipping settings (admin only)
export const updateShippingSettings = async (req, res, next) => {
  console.log('updatedshipping')
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      throw new createError("صلاحيات غير كافية", 403);
    }

    const {
      freeShippingEnabled,
      freeShippingMinimum,
      shippingFee,
      freePickupShipping,
      freeMetroShipping,
      metroAreas
    } = req.body;

    const settings = await ShippingSettings.getSettings();

    if (freeShippingEnabled !== undefined) settings.freeShippingEnabled = freeShippingEnabled;
    if (freeShippingMinimum !== undefined) settings.freeShippingMinimum = freeShippingMinimum;
    if (shippingFee !== undefined) settings.shippingFee = shippingFee;
    if (freePickupShipping !== undefined) settings.freePickupShipping = freePickupShipping;
    if (freeMetroShipping !== undefined) settings.freeMetroShipping = freeMetroShipping;
    if (metroAreas !== undefined) settings.metroAreas = metroAreas;

    await settings.save();

    res.status(200).json({ status: "success", message: 'تم تحديث إعدادات الشحن بنجاح', data: settings });
  } catch (error) {
    next(error);
  }
};

// Calculate shipping fee (public utility)
export const calculateShippingFee = async (req, res, next) => {
  try {
    const { subtotal, deliveryMethod, address } = req.body;

    const settings = await ShippingSettings.getSettings();
    let shippingFee = settings.shippingFee;

    // Free shipping based on minimum order
    if (settings.freeShippingEnabled && subtotal >= settings.freeShippingMinimum) {
      shippingFee = 0;
    }

    // Free pickup shipping
    if (settings.freePickupShipping && deliveryMethod === 'pickup') {
      shippingFee = 0;
    }

    // Free metro shipping
    if (settings.freeMetroShipping && address) {
      const isMetro = settings.metroAreas?.some(area => 
        address.toLowerCase().includes(area.toLowerCase())
      );
      if (isMetro) {
        shippingFee = 0;
      }
    }

    res.status(200).json({ shippingFee });
  } catch (error) {
    next(error);
  }
};