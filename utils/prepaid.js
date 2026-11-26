// Flat discount for paying in advance (InstaPay / wallet transfer now, card later).
// It comes off the merchandise only: shipping is never discounted and the total never goes below the shipping fee.
export const PREPAID_METHODS = ['instapay', 'wallet', 'card'];

export const prepaidDiscountEgp = () => {
  const v = Number(process.env.PREPAID_DISCOUNT_EGP);
  return Number.isFinite(v) && v >= 0 ? v : 50;
};

/** @param merchandisePiasters order total minus shipping, after every other discount (integer piasters) */
export const prepaidDiscountPiasters = (paymentMethod, merchandisePiasters) => {
  if (!PREPAID_METHODS.includes(paymentMethod)) return 0;
  return Math.max(0, Math.min(Math.round(prepaidDiscountEgp() * 100), Math.round(merchandisePiasters || 0)));
};
