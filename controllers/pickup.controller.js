import PickupPoint from '../models/pickupPoint.model.js';

export const createPickupPoint = async (req, res) => {
  try {
    const { stationName, location, address, phone, workingHours, status } = req.body;

    const pickupPoint = new PickupPoint({
      stationName,
      location,
      address,
      phone,
      workingHours,
      status: status || 'active'
    });
    console.log(req.body,';;;;;;')
    await pickupPoint.save();
    res.status(201).json(pickupPoint);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getPickupPoints = async (req, res) => {
  try {
    const pickupPoints = await PickupPoint.find();
    res.json(pickupPoints);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updatePickupPoint = async (req, res) => {
  try {
    const { id } = req.params;
    const { stationName, location, address, phone, workingHours, status } = req.body;

    const updatedPickupPoint = await PickupPoint.findByIdAndUpdate(
      id,
      {
        stationName,
        location,
        address,
        phone,
        workingHours,
        status,
        updatedAt: Date.now()
      },
      { new: true } // Return the updated document
    );

    if (!updatedPickupPoint) {
      return res.status(404).json({ message: 'Pickup point not found' });
    }

    res.json(updatedPickupPoint);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deletePickupPoint = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedPickupPoint = await PickupPoint.findByIdAndDelete(id);

    if (!deletedPickupPoint) {
      return res.status(404).json({ message: 'Pickup point not found' });
    }

    res.json({ message: 'Pickup point deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};