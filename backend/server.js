const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();

const app = express();

const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.ADMIN_URL,
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS policy: this origin not allowed: ' + origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function uploadToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: folder || 'FamilyFashionHub', resource_type: 'image' },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

async function uploadMultiple(files, folder) {
  return Promise.all(files.map(f => uploadToCloudinary(f.buffer, folder)));
}

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ MongoDB Connected');
    try {
      await mongoose.connection.collection('orders').dropIndex('orderId_1');
      console.log('🔧 Bad orderId index dropped');
    } catch(e) {}
    autoSetupAdmin();
  })
  .catch(err => console.error('❌ MongoDB Error:', err));

const productSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  description: { type: String, default: '' },
  price:       { type: Number, required: true },
  oldPrice:    { type: Number, default: 0 },
  saving:      { type: Number, default: 0 },
  img:         { type: String, default: '' },
  images:      [{ url: String, public_id: String }],
  category:    { type: String, required: true },
  subcategory: { type: String, default: '' },
  onSale:      { type: Boolean, default: false },
  soldOut:     { type: Boolean, default: false },
  featured:    { type: Boolean, default: false },
  sizes:          [{ type: String }],
  colors:         [{ type: String }],
  ageGroup:       { type: String, default: '' },
  material:       { type: String, default: '' },
  stock:          { type: Number, default: 0 },
  sku:            { type: String, default: '' },
  weight:         { type: String, default: '' },
  deliveryInfo:   { type: String, default: '' },
  returnPolicy:   { type: String, default: '' },
  highlights:     [{ type: String }],
  careInstructions: { type: String, default: '' },
  tags:           [{ type: String }],
  createdAt:   { type: Date, default: Date.now },
});

const reviewSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  phone:       { type: String, default: '' },
  rating:      { type: Number, required: true, min: 1, max: 5 },
  comment:     { type: String, required: true },
  productId:   { type: String, default: '' },
  productName: { type: String, default: '' },
  featured:    { type: Boolean, default: false },
  approved:    { type: Boolean, default: false },
  createdAt:   { type: Date, default: Date.now },
});

const userSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  phone:     { type: String, required: true, unique: true },
  password:  { type: String, required: true },
  role:      { type: String, default: 'user' },
  createdAt: { type: Date, default: Date.now },
});

const settingsSchema = new mongoose.Schema({
  key:   { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed,
});

const orderSchema = new mongoose.Schema({
  customerName: { type: String, default: '' },
  phone:        { type: String, default: '' },
  address:      { type: String, default: '' },
  items: [{
    productId: String,
    name:      String,
    price:     Number,
    quantity:  Number,
    img:       String,
  }],
  total:        { type: Number, default: 0 },
  deliveryArea: { type: String, default: 'inside' },
  status:       { type: String, default: 'pending', enum: ['pending','processing','shipped','delivered','cancelled'] },
  note:         { type: String, default: '' },
  createdAt:    { type: Date, default: Date.now },
});

const Product  = mongoose.model('Product',  productSchema);
const Review   = mongoose.model('Review',   reviewSchema);
const User     = mongoose.model('User',     userSchema);
const Settings = mongoose.model('Settings', settingsSchema);
const Order    = mongoose.model('Order',    orderSchema);

async function autoSetupAdmin() {
  try {
    const adminPhone = process.env.ADMIN_USERNAME;
    const adminPass  = process.env.ADMIN_PASSWORD;
    if (!adminPhone || !adminPass) {
      console.log('⚠️  ADMIN_USERNAME or ADMIN_PASSWORD missing — skip auto setup');
      return;
    }
    const existing = await User.findOne({ phone: adminPhone, role: 'admin' });
    if (existing) {
      console.log('ℹ️  Admin already exists:', adminPhone);
      return;
    }
    const hashed = await bcrypt.hash(adminPass, 10);
    await User.create({
      name:     'Super Admin',
      phone:    adminPhone,
      password: hashed,
      role:     'admin',
    });
    console.log('✅ Auto Admin created — Phone/Username:', adminPhone);
  } catch (err) {
    console.error('❌ Auto admin setup error:', err.message);
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'ffh_secret_2024';

function authMiddleware(req, res, next) {
  const token = (req.headers.authorization || '').split(' ')[1];
  if (!token) return res.json({ success: false, message: 'No token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.json({ success: false, message: 'Invalid token' }); }
}

function adminMiddleware(req, res, next) {
  const token = (req.headers.authorization || '').split(' ')[1];
  if (!token) return res.json({ success: false, message: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.json({ success: false, message: 'Admin access required' });
    req.user = decoded;
    next();
  } catch { res.json({ success: false, message: 'Invalid token' }); }
}

app.get('/api/products', async (req, res) => {
  try {
    const { category, subcategory, onSale, featured, limit = 100, page = 1, search } = req.query;
    const filter = {};
    if (category && category !== 'all') filter.category = category;
    if (subcategory) filter.subcategory = subcategory;
    if (onSale   === 'true') filter.onSale   = true;
    if (featured === 'true') filter.featured = true;
    if (search) filter.name = { $regex: search, $options: 'i' };
    const products = await Product.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));
    const total = await Product.countDocuments(filter);
    res.json({ success: true, data: products, total, page: parseInt(page) });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.json({ success: false, message: 'Product not found' });
    res.json({ success: true, data: product });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/products', adminMiddleware, upload.array('images', 10), async (req, res) => {
  try {
    const {
      name, description, price, oldPrice, saving, category, subcategory, onSale, soldOut, featured,
      ageGroup, material, stock, sku, weight, deliveryInfo, returnPolicy, careInstructions,
      sizes, colors, highlights, tags,
    } = req.body;
    let images = [];
    if (req.files && req.files.length > 0) {
      const results = await uploadMultiple(req.files);
      images = results.map(r => ({ url: r.secure_url, public_id: r.public_id }));
    }
    const img = images.length > 0 ? images[0].url : '';
    const parseArr = v => {
      if (!v) return [];
      if (Array.isArray(v)) return v.map(x => x.trim()).filter(Boolean);
      return v.split(',').map(x => x.trim()).filter(Boolean);
    };
    const product = await Product.create({
      name, description,
      price:       +price,
      oldPrice:    +(oldPrice || 0),
      saving:      +(saving   || 0),
      category,
      subcategory: subcategory || '',
      img, images,
      onSale:   onSale   === 'true',
      soldOut:  soldOut  === 'true',
      featured: featured === 'true',
      ageGroup:         ageGroup || '',
      material:         material || '',
      stock:            +(stock  || 0),
      sku:              sku || '',
      weight:           weight || '',
      deliveryInfo:     deliveryInfo || '',
      returnPolicy:     returnPolicy || '',
      careInstructions: careInstructions || '',
      sizes:      parseArr(sizes),
      colors:     parseArr(colors),
      highlights: parseArr(highlights),
      tags:       parseArr(tags),
    });
    res.json({ success: true, data: product });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.put('/api/products/:id', adminMiddleware, upload.array('images', 10), async (req, res) => {
  try {
    const {
      name, description, price, oldPrice, saving, category, subcategory, onSale, soldOut, featured,
      ageGroup, material, stock, sku, weight, deliveryInfo, returnPolicy, careInstructions,
      sizes, colors, highlights, tags,
    } = req.body;
    const parseArr = v => {
      if (!v) return [];
      if (Array.isArray(v)) return v.map(x => x.trim()).filter(Boolean);
      return v.split(',').map(x => x.trim()).filter(Boolean);
    };
    const update = {
      name, description,
      price:       +price,
      oldPrice:    +(oldPrice || 0),
      saving:      +(saving   || 0),
      category,
      subcategory: subcategory || '',
      onSale:   onSale   === 'true',
      soldOut:  soldOut  === 'true',
      featured: featured === 'true',
      ageGroup:         ageGroup || '',
      material:         material || '',
      stock:            +(stock  || 0),
      sku:              sku || '',
      weight:           weight || '',
      deliveryInfo:     deliveryInfo || '',
      returnPolicy:     returnPolicy || '',
      careInstructions: careInstructions || '',
      sizes:      parseArr(sizes),
      colors:     parseArr(colors),
      highlights: parseArr(highlights),
      tags:       parseArr(tags),
    };
    if (req.files && req.files.length > 0) {
      const old = await Product.findById(req.params.id);
      if (old && old.images && old.images.length) {
        await Promise.all(
          old.images
            .filter(img => img.public_id)
            .map(img => cloudinary.uploader.destroy(img.public_id).catch(() => {}))
        );
      }
      const results = await uploadMultiple(req.files);
      update.images = results.map(r => ({ url: r.secure_url, public_id: r.public_id }));
      update.img    = update.images[0].url;
    }
    const product = await Product.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json({ success: true, data: product });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.delete('/api/products/:id', adminMiddleware, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.json({ success: false, message: 'Product not found' });
    if (product.images && product.images.length) {
      await Promise.all(
        product.images
          .filter(img => img.public_id)
          .map(img => cloudinary.uploader.destroy(img.public_id).catch(() => {}))
      );
    }
    await Product.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Product deleted' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/reviews', async (req, res) => {
  try {
    const { featured, productId } = req.query;
    const filter = { approved: true };
    if (featured === 'true') filter.featured = true;
    if (productId) filter.productId = productId;
    const reviews = await Review.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: reviews });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/admin/reviews', adminMiddleware, async (req, res) => {
  try {
    const reviews = await Review.find().sort({ createdAt: -1 });
    res.json({ success: true, data: reviews });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/reviews', async (req, res) => {
  try {
    const { name, phone, rating, comment, productId, productName } = req.body;
    const review = await Review.create({ name, phone, rating: +rating, comment, productId, productName });
    res.json({ success: true, data: review, message: 'Review submitted successfully' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.put('/api/reviews/:id', adminMiddleware, async (req, res) => {
  try {
    const review = await Review.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, data: review });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.delete('/api/reviews/:id', adminMiddleware, async (req, res) => {
  try {
    await Review.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Review deleted' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/users/register', async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    const exists = await User.findOne({ phone });
    if (exists) return res.json({ success: false, message: 'Phone already registered' });
    const hashed = await bcrypt.hash(password, 10);
    const user   = await User.create({ name, phone, password: hashed });
    const token  = jwt.sign({ id: user._id, phone: user.phone, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, user: { id: user._id, name: user.name, phone: user.phone, role: user.role }, token });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/users/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const user = await User.findOne({ phone });
    if (!user) return res.json({ success: false, message: 'Invalid phone or password' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ success: false, message: 'Invalid phone or password' });
    const token = jwt.sign({ id: user._id, phone: user.phone, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, user: { id: user._id, name: user.name, phone: user.phone, role: user.role }, token });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (
      phone === process.env.ADMIN_USERNAME &&
      password === process.env.ADMIN_PASSWORD
    ) {
      let user = await User.findOne({ phone: process.env.ADMIN_USERNAME, role: 'admin' });
      if (!user) {
        const hashed = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
        user = await User.create({
          name: 'Super Admin',
          phone: process.env.ADMIN_USERNAME,
          password: hashed,
          role: 'admin',
        });
      }
      const token = jwt.sign({ id: user._id, phone: user.phone, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ success: true, user: { id: user._id, name: user.name, phone: user.phone, role: 'admin' }, token });
    }
    const user = await User.findOne({ phone, role: 'admin' });
    if (!user) return res.json({ success: false, message: 'Admin not found' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ success: false, message: 'Wrong password' });
    const token = jwt.sign({ id: user._id, phone: user.phone, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, user: { id: user._id, name: user.name, phone: user.phone, role: 'admin' }, token });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/admin/users', adminMiddleware, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json({ success: true, data: users });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/admin/users', adminMiddleware, async (req, res) => {
  try {
    const { name, phone, password, role } = req.body;
    const exists = await User.findOne({ phone });
    if (exists) return res.json({ success: false, message: 'Phone already exists' });
    const hashed = await bcrypt.hash(password, 10);
    const user   = await User.create({ name, phone, password: hashed, role: role || 'user' });
    res.json({ success: true, data: { id: user._id, name: user.name, phone: user.phone, role: user.role } });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.delete('/api/admin/users/:id', adminMiddleware, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'User deleted' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/orders/debug', (req, res) => {
  console.log('ORDER DEBUG body:', JSON.stringify(req.body, null, 2));
  res.json({ success: true, received: req.body });
});

app.post('/api/orders', async (req, res) => {
  try {
    const b = req.body;
    const customerName =
      b.customerName || b.customer_name || b.name || b.fullName ||
      b.full_name || b.userName || b.user_name || b.buyerName || '';
    const phone =
      b.phone || b.mobile || b.phoneNumber || b.phone_number ||
      b.mobileNumber || b.mobile_number || b.contact || b.number || '';
    const address =
      b.address || b.shippingAddress || b.shipping_address ||
      b.deliveryAddress || b.delivery_address || b.location || '';
    const note =
      b.note || b.notes || b.message || b.orderNote || b.order_note || '';
    let items = b.items || b.cartItems || b.cart || b.products || [];
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch { items = []; }
    }
    let total = parseFloat(b.total || b.totalPrice || b.total_price ||
      b.amount || b.grandTotal || b.grand_total || 0);
    if (!total && items.length) {
      total = items.reduce((sum, item) => {
        const price = parseFloat(item.price || item.unitPrice || 0);
        const qty   = parseInt(item.quantity || item.qty || 1, 10);
        return sum + price * qty;
      }, 0);
    }
    const errors = [];
    if (!customerName) errors.push('Customer name required');
    if (!phone)        errors.push('Phone number required');
    if (!address)      errors.push('Address required');
    if (!total)        errors.push('Total amount not found');
    if (errors.length) {
      return res.json({ success: false, message: errors.join(', ') });
    }
    const normalizedItems = items.map(item => ({
      productId: item.productId || item.product_id || item._id || item.id || '',
      name:      item.name || item.productName || item.product_name || item.title || '',
      price:     parseFloat(item.price || item.unitPrice || 0),
      quantity:  parseInt(item.quantity || item.qty || 1, 10),
      img:       item.img || item.image || item.thumbnail || item.photo || '',
    }));
    const order = await Order.create({
      customerName,
      phone,
      address,
      items: normalizedItems,
      total,
      note,
      status: 'pending',
    });
    res.json({
      success: true,
      data: order,
      message: 'Order placed successfully! We will contact you soon.',
      orderId: order._id,
    });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.get('/api/admin/orders', adminMiddleware, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = (status && status !== 'all') ? { status } : {};
    const orders = await Order.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: orders });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.put('/api/admin/orders/:id', adminMiddleware, async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, data: order });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.delete('/api/admin/orders/:id', adminMiddleware, async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Order deleted' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/categories', async (req, res) => {
  try {
    const setting = await Settings.findOne({ key: 'categories' });
    if (setting && Array.isArray(setting.value) && setting.value.length) {
      return res.json({ success: true, data: setting.value });
    }
    res.json({
      success: true,
      data: [
        { value: 'baby_dress', label: '🧸 Baby Dress', subcategories: [
            { value: 'newborn_set',    label: 'Newborn Set (0-6 Months)' },
            { value: 'cotton_dress',   label: 'Cotton Dress (Summer Comfort)' },
            { value: 'winter_dress',   label: 'Winter Dress' },
            { value: 'frocks_tshirts', label: 'Frocks, T-Shirts & Pants' },
        ]},
        { value: 'toys', label: '🧸 Toys', subcategories: [
            { value: 'soft_toys',        label: 'Soft Toys (Dolls)' },
            { value: 'sound_toys',       label: 'সাউন্ড টয় (Musical Toys)' },
            { value: 'educational_toys', label: 'Educational Toys (ABC/Numbers)' },
            { value: 'baby_rattle',      label: 'Baby Rattle' },
        ]},
        { value: 'feeding', label: '🍼 Feeding Items', subcategories: [
            { value: 'feeding_bottle', label: 'Feeding Bottle' },
            { value: 'feeding_bowl',   label: 'Baby Feeding Bowl + Spoon' },
            { value: 'sipper_cup',     label: 'Sipper Cup' },
            { value: 'feeding_chair',  label: 'Baby Feeding Chair' },
        ]},
        { value: 'baby_care', label: '🛁 Baby Care', subcategories: [
            { value: 'soap_shampoo', label: 'Baby Soap & Shampoo' },
            { value: 'lotion_oil',   label: 'Baby Lotion / Oil' },
            { value: 'wet_tissue',   label: 'Wet Tissue' },
            { value: 'diaper',       label: 'Diaper' },
        ]},
        { value: 'baby_bedding', label: '👶 Essentials', subcategories: [
            { value: 'mosquito_net', label: 'Baby Mosquito Net' },
            { value: 'baby_bed',     label: 'Baby Bed / Nest' },
            { value: 'blanket',      label: 'Baby Blanket' },
            { value: 'towel',        label: 'Baby Towel' },
        ]},
        { value: 'trending', label: '🔥 Trending', subcategories: [
            { value: 'baby_carrier',   label: 'Baby Carrier' },
            { value: 'baby_walker',    label: 'Baby Walker' },
            { value: 'nail_cutter',    label: 'Baby Nail Cutter Set' },
            { value: 'thermometer',    label: 'Baby Thermometer' },
        ]},
      ]
    });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/admin/categories', adminMiddleware, async (req, res) => {
  try {
    const { value, label } = req.body;
    if (!value || !label) return res.json({ success: false, message: 'value and label required' });
    const slug = value.trim().toLowerCase().replace(/\s+/g, '_');
    const setting = await Settings.findOne({ key: 'categories' });
    let cats = (setting && Array.isArray(setting.value)) ? setting.value : [];
    if (cats.find(c => c.value === slug)) return res.json({ success: false, message: 'Category already exists' });
    cats.push({ value: slug, label: label.trim(), subcategories: [] });
    await Settings.findOneAndUpdate({ key: 'categories' }, { key: 'categories', value: cats }, { upsert: true });
    res.json({ success: true, data: cats, message: 'Category added' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.put('/api/admin/categories/:value', adminMiddleware, async (req, res) => {
  try {
    const { label } = req.body;
    if (!label) return res.json({ success: false, message: 'label required' });
    const setting = await Settings.findOne({ key: 'categories' });
    let cats = (setting && Array.isArray(setting.value)) ? setting.value : [];
    const idx = cats.findIndex(c => c.value === req.params.value);
    if (idx === -1) return res.json({ success: false, message: 'Category not found' });
    cats[idx].label = label.trim();
    await Settings.findOneAndUpdate({ key: 'categories' }, { key: 'categories', value: cats }, { upsert: true });
    res.json({ success: true, data: cats, message: 'Category updated' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.delete('/api/admin/categories/:value', adminMiddleware, async (req, res) => {
  try {
    const setting = await Settings.findOne({ key: 'categories' });
    let cats = (setting && Array.isArray(setting.value)) ? setting.value : [];
    cats = cats.filter(c => c.value !== req.params.value);
    await Settings.findOneAndUpdate({ key: 'categories' }, { key: 'categories', value: cats }, { upsert: true });
    res.json({ success: true, data: cats, message: 'Category deleted' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/admin/categories/:catValue/subcategories', adminMiddleware, async (req, res) => {
  try {
    const { value, label } = req.body;
    if (!value || !label) return res.json({ success: false, message: 'value and label required' });
    const slug = value.trim().toLowerCase().replace(/\s+/g, '_');
    const setting = await Settings.findOne({ key: 'categories' });
    let cats = (setting && Array.isArray(setting.value)) ? setting.value : [];
    const cat = cats.find(c => c.value === req.params.catValue);
    if (!cat) return res.json({ success: false, message: 'Category not found' });
    if (!cat.subcategories) cat.subcategories = [];
    if (cat.subcategories.find(s => s.value === slug)) return res.json({ success: false, message: 'Subcategory already exists' });
    cat.subcategories.push({ value: slug, label: label.trim() });
    await Settings.findOneAndUpdate({ key: 'categories' }, { key: 'categories', value: cats }, { upsert: true });
    res.json({ success: true, data: cats, message: 'Subcategory added' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.put('/api/admin/categories/:catValue/subcategories/:subValue', adminMiddleware, async (req, res) => {
  try {
    const { label } = req.body;
    if (!label) return res.json({ success: false, message: 'label required' });
    const setting = await Settings.findOne({ key: 'categories' });
    let cats = (setting && Array.isArray(setting.value)) ? setting.value : [];
    const cat = cats.find(c => c.value === req.params.catValue);
    if (!cat) return res.json({ success: false, message: 'Category not found' });
    const sub = (cat.subcategories || []).find(s => s.value === req.params.subValue);
    if (!sub) return res.json({ success: false, message: 'Subcategory not found' });
    sub.label = label.trim();
    await Settings.findOneAndUpdate({ key: 'categories' }, { key: 'categories', value: cats }, { upsert: true });
    res.json({ success: true, data: cats, message: 'Subcategory updated' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.delete('/api/admin/categories/:catValue/subcategories/:subValue', adminMiddleware, async (req, res) => {
  try {
    const setting = await Settings.findOne({ key: 'categories' });
    let cats = (setting && Array.isArray(setting.value)) ? setting.value : [];
    const cat = cats.find(c => c.value === req.params.catValue);
    if (!cat) return res.json({ success: false, message: 'Category not found' });
    cat.subcategories = (cat.subcategories || []).filter(s => s.value !== req.params.subValue);
    await Settings.findOneAndUpdate({ key: 'categories' }, { key: 'categories', value: cats }, { upsert: true });
    res.json({ success: true, data: cats, message: 'Subcategory deleted' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/admin/categories/bulk', adminMiddleware, async (req, res) => {
  try {
    const { categories } = req.body;
    if (!Array.isArray(categories)) return res.json({ success: false, message: 'categories array required' });
    await Settings.findOneAndUpdate({ key: 'categories' }, { key: 'categories', value: categories }, { upsert: true });
    res.json({ success: true, data: categories, message: 'Categories saved' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/settings', async (req, res) => {
  try {
    const settings = await Settings.find();
    const data = {};
    settings.forEach(s => { data[s.key] = s.value; });
    res.json({ success: true, data });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/settings', adminMiddleware, async (req, res) => {
  try {
    const entries = Object.entries(req.body);
    for (const [key, value] of entries) {
      await Settings.findOneAndUpdate({ key }, { key, value }, { upsert: true });
    }
    res.json({ success: true, message: 'Settings updated' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/admin/stats', adminMiddleware, async (req, res) => {
  try {
    const [products, orders, users, reviews] = await Promise.all([
      Product.countDocuments(),
      Order.countDocuments(),
      User.countDocuments({ role: 'user' }),
      Review.countDocuments(),
    ]);
    const revenue = await Order.aggregate([
      { $match: { status: 'delivered' } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]);
    const pendingOrders = await Order.countDocuments({ status: 'pending' });
    res.json({
      success: true,
      data: { products, orders, users, reviews, revenue: revenue[0]?.total || 0, pendingOrders },
    });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/upload', adminMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.json({ success: false, message: 'No image' });
    const result = await uploadToCloudinary(req.file.buffer);
    res.json({ success: true, url: result.secure_url, public_id: result.public_id });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/setup-admin', async (req, res) => {
  try {
    const count = await User.countDocuments({ role: 'admin' });
    if (count > 0) return res.json({ success: false, message: 'Admin already exists' });
    const { name, phone, password } = req.body;
    if (!name || !phone || !password) return res.json({ success: false, message: 'All fields required' });
    const hashed = await bcrypt.hash(password, 10);
    const user   = await User.create({ name, phone, password: hashed, role: 'admin' });
    res.json({ success: true, message: 'Admin created', user: { name: user.name, phone: user.phone } });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/admin/health', adminMiddleware, (req, res) => {
  res.json({
    success: true,
    env: {
      PORT:                 process.env.PORT,
      MONGODB_URI:          process.env.MONGODB_URI ? '✅ set' : '❌ missing',
      CLOUDINARY_CLOUD:     process.env.CLOUDINARY_CLOUD_NAME ? '✅ set' : '❌ missing',
      CLOUDINARY_API_KEY:   process.env.CLOUDINARY_API_KEY ? '✅ set' : '❌ missing',
      CLOUDINARY_API_SECRET:process.env.CLOUDINARY_API_SECRET ? '✅ set' : '❌ missing',
      JWT_SECRET:           process.env.JWT_SECRET ? '✅ set' : '❌ missing',
      ADMIN_USERNAME:       process.env.ADMIN_USERNAME || '❌ missing',
      FRONTEND_URL:         process.env.FRONTEND_URL || '❌ missing',
      ADMIN_URL:            process.env.ADMIN_URL || '❌ missing',
    }
  });
});

app.post('/api/admin/seed-categories', adminMiddleware, async (req, res) => {
  try {
    const existing = await Settings.findOne({ key: 'categories' });
    if (existing && Array.isArray(existing.value) && existing.value.length) {
      return res.json({ success: false, message: 'Categories already exist. Send force=true to reset.' });
    }
    const defaultCategories = [
      { value: 'baby_dress', label: '🧸 Baby Dress', subcategories: [
          { value: 'newborn_set',    label: 'Newborn Set (0-6 Months)' },
          { value: 'cotton_dress',   label: 'Cotton Dress (Summer Comfort)' },
          { value: 'winter_dress',   label: 'Winter Dress' },
          { value: 'frocks_tshirts', label: 'Frocks, T-Shirts & Pants' },
      ]},
      { value: 'toys', label: '🧸 Toys', subcategories: [
          { value: 'soft_toys',        label: 'Soft Toys (Dolls)' },
          { value: 'sound_toys',       label: 'সাউন্ড টয় (Musical Toys)' },
          { value: 'educational_toys', label: 'Educational Toys (ABC/Numbers)' },
          { value: 'baby_rattle',      label: 'Baby Rattle' },
      ]},
      { value: 'feeding', label: '🍼 Feeding Items', subcategories: [
          { value: 'feeding_bottle', label: 'Feeding Bottle' },
          { value: 'feeding_bowl',   label: 'Baby Feeding Bowl + Spoon' },
          { value: 'sipper_cup',     label: 'Sipper Cup' },
          { value: 'feeding_chair',  label: 'Baby Feeding Chair' },
      ]},
      { value: 'baby_care', label: '🛁 Baby Care', subcategories: [
          { value: 'soap_shampoo', label: 'Baby Soap & Shampoo' },
          { value: 'lotion_oil',   label: 'Baby Lotion / Oil' },
          { value: 'wet_tissue',   label: 'Wet Tissue' },
          { value: 'diaper',       label: 'Diaper' },
      ]},
      { value: 'baby_bedding', label: '👶 Essentials', subcategories: [
          { value: 'mosquito_net', label: 'Baby Mosquito Net' },
          { value: 'baby_bed',     label: 'Baby Bed / Nest' },
          { value: 'blanket',      label: 'Baby Blanket' },
          { value: 'towel',        label: 'Baby Towel' },
      ]},
      { value: 'trending', label: '🔥 Trending', subcategories: [
          { value: 'baby_carrier',   label: 'Baby Carrier' },
          { value: 'baby_walker',    label: 'Baby Walker' },
          { value: 'nail_cutter',    label: 'Baby Nail Cutter Set' },
          { value: 'thermometer',    label: 'Baby Thermometer' },
      ]},
    ];
    await Settings.findOneAndUpdate(
      { key: 'categories' },
      { key: 'categories', value: defaultCategories },
      { upsert: true }
    );
    res.json({ success: true, message: 'Default baby categories seeded!', data: defaultCategories });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/product-layout', async (req, res) => {
  try {
    const setting = await Settings.findOne({ key: 'productLayout' });
    const defaultLayout = {
      showAddToCart:   true,
      showBuyNow:      true,
      showWhatsApp:    true,
      showCallOrder:   true,
      addToCartText:   'ADD TO CART',
      buyNowText:      'BUY NOW',
      whatsappText:    'Order On WhatsApp',
      callOrderText:   'Call For Order',
      whatsappNumber:  '',
      callNumber:      '',
      showPriceSection:       true,
      showSavingBadge:        true,
      showQuantitySelector:   true,
      showSizeSelector:       true,
      showColorSelector:      true,
      showBrandLabel:         true,
      showHighlights:         true,
      showDescription:        true,
      showMaterial:           true,
      showAgeGroup:           true,
      showDeliveryInfo:       true,
      showReturnPolicy:       true,
      showCareInstructions:   true,
      showStockStatus:        true,
      showMoreProducts:       true,
      moreProductsTitle:      'More Products',
      brandLabel:             'Family Fashion Hub',
      showReviewsTab:         true,
    };
    const layout = (setting && setting.value) ? { ...defaultLayout, ...setting.value } : defaultLayout;
    res.json({ success: true, data: layout });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/admin/product-layout', adminMiddleware, async (req, res) => {
  try {
    const layout = req.body;
    await Settings.findOneAndUpdate(
      { key: 'productLayout' },
      { key: 'productLayout', value: layout },
      { upsert: true }
    );
    res.json({ success: true, message: 'Product layout saved', data: layout });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.use(express.static(path.join(__dirname, 'frontend')));
app.use('/admin', express.static(path.join(__dirname, 'admin_panel')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'index.html')));

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin_panel', 'index.html')));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));