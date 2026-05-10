require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Category = require('./models/Category');
const Product = require('./models/Product');

async function seedDatabase() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/noon-ecommerce');
        console.log('Connected to database');
        
        // Clear existing data
        await User.deleteMany({});
        await Category.deleteMany({});
        await Product.deleteMany({});
        
        console.log('Cleared existing data');
        
        // Hash passwords manually
        const saltRounds = 10;
        const adminHash = await bcrypt.hash('admin123', saltRounds);
        const userHash = await bcrypt.hash('user123', saltRounds);
        
        // Create admin user - SIMPLE PASSWORD (will be hashed by model middleware)
        const admin = new User({
            name: 'Admin User',
            email: 'admin@noon.com',
            password: 'admin123', // Plain text - will be hashed by pre-save middleware
            role: 'admin',
            phone: '+1234567890',
            avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop'
        });
        await admin.save();
        console.log('Admin user created');
        
        // Create regular user
        const user = new User({
            name: 'John Doe',
            email: 'john@example.com',
            password: userHash,
            phone: '+1234567891',
            avatar: 'https://images.unsplash.com/photo-1494790108755-2616b612b786?w-400&h=400&fit=crop',
            addresses: [{
                street: '123 Main St',
                city: 'New York',
                state: 'NY',
                country: 'USA',
                zipCode: '10001',
                isDefault: true
            }]
        });
        await user.save();
        
        console.log('Created users');
        
        // Create categories
        const electronics = new Category({
            name: 'Electronics',
            slug: 'electronics',
            description: 'Electronic devices and accessories',
            image: 'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=600&h=400&fit=crop'
        });
        await electronics.save();
        
        const fashion = new Category({
            name: 'Fashion',
            slug: 'fashion',
            description: 'Clothing and accessories',
            image: 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=600&h=400&fit=crop'
        });
        await fashion.save();
        
        const home = new Category({
            name: 'Home & Kitchen',
            slug: 'home',
            description: 'Home appliances and kitchenware',
            image: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=600&h=400&fit=crop'
        });
        await home.save();
        
        const sports = new Category({
            name: 'Sports',
            slug: 'sports',
            description: 'Sports equipment and accessories',
            image: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=600&h=400&fit=crop'
        });
        await sports.save();
        
        console.log('Created categories');
        
        // Create products with Unsplash images
        const products = [
            // Electronics
            {
                name: 'iPhone 15 Pro Max',
                slug: 'iphone-15-pro-max',
                description: 'The ultimate iPhone with titanium design, A17 Pro chip, and advanced camera system',
                brand: 'Apple',
                category: electronics._id,
                price: 1199,
                discountPrice: 1099,
                stock: 50,
                colors: ['Natural Titanium', 'Blue Titanium', 'White Titanium', 'Black Titanium'],
                specifications: {
                    'Display': '6.7-inch Super Retina XDR',
                    'Processor': 'A17 Pro chip',
                    'Storage': '256GB',
                    'Camera': '48MP Main + 12MP Ultra Wide + 12MP Telephoto',
                    'Battery': 'Up to 29 hours video playback'
                },
                features: ['5G', 'Face ID', 'Titanium design', 'USB-C', 'Dynamic Island'],
                images: [
                    'https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=800&h=600&fit=crop',
                    'https://images.unsplash.com/photo-1695048133088-0d7c68c7aae4?w=800&h=600&fit=crop',
                    'https://images.unsplash.com/photo-1695048133117-6d9cc3c8e14c?w=800&h=600&fit=crop'
                ],
                isFeatured: true,
                rating: 4.8,
                reviewsCount: 1250
            },
            {
                name: 'Samsung Galaxy S24 Ultra',
                slug: 'samsung-galaxy-s24-ultra',
                description: 'Flagship smartphone with S Pen, titanium frame, and AI-powered features',
                brand: 'Samsung',
                category: electronics._id,
                price: 1299,
                stock: 75,
                colors: ['Titanium Gray', 'Titanium Black', 'Titanium Violet', 'Titanium Yellow'],
                specifications: {
                    'Display': '6.8-inch Dynamic AMOLED 2X',
                    'Processor': 'Snapdragon 8 Gen 3',
                    'Storage': '512GB',
                    'Camera': '200MP Wide + 12MP Ultra Wide + 50MP Telephoto',
                    'Battery': '5000mAh'
                },
                features: ['S Pen included', 'Titanium frame', 'AI camera', '100x Space Zoom', '45W fast charging'],
                images: [
                    'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?w=800&h=600&fit=crop',
                    'https://images.unsplash.com/photo-1610945264803-c22b62d2a7b3?w=800&h=600&fit=crop'
                ],
                isFeatured: true,
                rating: 4.7,
                reviewsCount: 980
            },
            {
                name: 'Sony WH-1000XM5 Headphones',
                slug: 'sony-wh-1000xm5-headphones',
                description: 'Industry-leading noise cancellation wireless headphones',
                brand: 'Sony',
                category: electronics._id,
                price: 399,
                discountPrice: 349,
                stock: 120,
                colors: ['Black', 'Silver', 'Blue'],
                specifications: {
                    'Noise Cancellation': 'Industry-leading',
                    'Battery Life': '30 hours',
                    'Charging': 'Quick charge (3 min = 3 hours)',
                    'Weight': '250g',
                    'Connectivity': 'Bluetooth 5.2'
                },
                features: ['Noise Cancelling', 'Hi-Res Audio', 'Touch controls', 'Voice assistant'],
                images: [
                    'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&h=600&fit=crop',
                    'https://images.unsplash.com/photo-1583394838336-acd977736f90?w=800&h=600&fit=crop'
                ],
                rating: 4.9,
                reviewsCount: 2340
            },
            {
                name: 'MacBook Pro 16-inch',
                slug: 'macbook-pro-16-inch',
                description: 'Professional laptop with M3 Max chip for extreme performance',
                brand: 'Apple',
                category: electronics._id,
                price: 2499,
                stock: 35,
                colors: ['Space Black', 'Silver'],
                specifications: {
                    'Processor': 'Apple M3 Max',
                    'Memory': '36GB',
                    'Storage': '1TB SSD',
                    'Display': '16.2-inch Liquid Retina XDR',
                    'Battery': 'Up to 22 hours'
                },
                features: ['M3 Max chip', 'Liquid Retina XDR display', 'Up to 22 hours battery', 'Six-speaker sound system'],
                images: [
                    'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800&h=600&fit=crop',
                    'https://images.unsplash.com/photo-1541807084-5c52b6b3adef?w=800&h=600&fit=crop'
                ],
                isFeatured: true,
                rating: 4.8,
                reviewsCount: 1560
            },
            
            // Fashion
            {
                name: 'Men\'s Leather Jacket',
                slug: 'mens-leather-jacket',
                description: 'Premium genuine leather jacket with vintage style',
                brand: 'Zara',
                category: fashion._id,
                price: 299,
                discountPrice: 229,
                stock: 85,
                colors: ['Black', 'Brown', 'Cognac'],
                sizes: ['S', 'M', 'L', 'XL', 'XXL'],
                specifications: {
                    'Material': '100% Genuine Leather',
                    'Lining': 'Polyester',
                    'Closure': 'Zipper',
                    'Pockets': '4 pockets'
                },
                features: ['Genuine leather', 'Vintage style', 'Multiple pockets', 'Warm lining'],
                images: [
                    'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=800&h=600&fit=crop',
                    'https://images.unsplash.com/photo-1551537482-f2075a1d41f1?w=800&h=600&fit=crop'
                ],
                rating: 4.6,
                reviewsCount: 890
            },
            {
                name: 'Nike Air Max 270',
                slug: 'nike-air-max-270',
                description: 'Iconic sneakers with visible Air cushioning',
                brand: 'Nike',
                category: fashion._id,
                price: 150,
                stock: 200,
                colors: ['Black/White', 'White/Blue', 'Red/Black', 'All Black'],
                sizes: ['US 7', 'US 8', 'US 9', 'US 10', 'US 11', 'US 12'],
                specifications: {
                    'Material': 'Mesh and synthetic',
                    'Closure': 'Lace-up',
                    'Cushioning': 'Nike Air',
                    'Weight': '320g'
                },
                features: ['Visible Air cushioning', 'Breathable mesh', 'Comfortable fit', 'Iconic design'],
                images: [
                    'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&h=600&fit=crop',
                    'https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=800&h=600&fit=crop'
                ],
                rating: 4.7,
                reviewsCount: 2100
            },
            
            // Home & Kitchen
            {
                name: 'KitchenAid Stand Mixer',
                slug: 'kitchenaid-stand-mixer',
                description: 'Professional grade stand mixer for all your baking needs',
                brand: 'KitchenAid',
                category: home._id,
                price: 449,
                discountPrice: 399,
                stock: 45,
                colors: ['Empire Red', 'Onyx Black', 'Contour Silver', 'Aqua Sky'],
                specifications: {
                    'Power': '590 watts',
                    'Capacity': '5.5 quarts',
                    'Speed Settings': '10',
                    'Attachments': '3 included'
                },
                features: ['10-speed control', 'Power hub', 'Durable construction', 'Multiple attachments available'],
                images: [
                    'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800&h=600&fit=crop',
                    'https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=800&h=600&fit=crop'
                ],
                isFeatured: true,
                rating: 4.9,
                reviewsCount: 1870
            },
            {
                name: 'Dyson V15 Vacuum Cleaner',
                slug: 'dyson-v15-vacuum-cleaner',
                description: 'Cordless vacuum with laser dust detection',
                brand: 'Dyson',
                category: home._id,
                price: 699,
                stock: 60,
                colors: ['Nickel/Yellow', 'Iron/Purple'],
                specifications: {
                    'Power': '230 AW',
                    'Battery': 'Up to 60 minutes',
                    'Filter': 'Whole-machine filtration',
                    'Weight': '3kg'
                },
                features: ['Laser dust detection', 'Cordless', 'HEPA filtration', 'Intelligent suction'],
                images: [
                    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&h=600&fit=crop',
                    'https://images.unsplash.com/photo-1558618666-6fd2ea5d6999?w=800&h=600&fit=crop'
                ],
                rating: 4.8,
                reviewsCount: 1320
            },
            {
                name: 'Nespresso Vertuo Coffee Machine',
                slug: 'nespresso-vertuo-coffee-machine',
                description: 'Automatic coffee and espresso machine with centrifusion technology',
                brand: 'Nespresso',
                category: home._id,
                price: 199,
                discountPrice: 169,
                stock: 90,
                colors: ['Black', 'Red', 'White', 'Silver'],
                specifications: {
                    'Capacity': '40 oz water tank',
                    'Pressure': '19 bars',
                    'Heat-up Time': '25 seconds',
                    'Capsule System': 'Vertuo'
                },
                features: ['Centrifusion technology', 'One-touch operation', 'Auto capsule ejection', 'Energy saving mode'],
                images: [
                    'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800&h=600&fit=crop',
                    'https://images.unsplash.com/photo-1511537190424-bbbab87ac5eb?w=800&h=600&fit=crop'
                ],
                rating: 4.6,
                reviewsCount: 980
            },
            
            // Sports
            {
                name: 'Wilson Evolution Basketball',
                slug: 'wilson-evolution-basketball',
                description: 'Official game basketball for high school and college',
                brand: 'Wilson',
                category: sports._id,
                price: 69,
                stock: 180,
                colors: ['Orange', 'Black/Orange'],
                specifications: {
                    'Size': 'Official Size 7',
                    'Material': 'Composite leather',
                    'Weight': '22 oz',
                    'Inflation': '7-9 PSI'
                },
                features: ['Official game ball', 'Excellent grip', 'Durable', 'Consistent bounce'],
                images: [
                    'https://images.unsplash.com/photo-1546519638-68e109498ffc?w=800&h=600&fit=crop',
                    'https://images.unsplash.com/photo-1519861531473-920034658307?w=800&h=600&fit=crop'
                ],
                rating: 4.7,
                reviewsCount: 760
            },
            {
                name: 'Adidas Soccer Ball',
                slug: 'adidas-soccer-ball',
                description: 'Official match soccer ball with thermal bonding technology',
                brand: 'Adidas',
                category: sports._id,
                price: 159,
                discountPrice: 129,
                stock: 120,
                colors: ['White/Blue', 'White/Red', 'White/Black'],
                specifications: {
                    'Size': 'Size 5',
                    'Material': 'PU',
                    'Panels': '32 panels',
                    'Weight': '420g'
                },
                features: ['Official match ball', 'Thermal bonding', 'Water resistant', 'Excellent aerodynamics'],
                images: [
                    'https://images.unsplash.com/photo-1575361204480-aadea25e6e68?w=800&h=600&fit=crop',
                    'https://images.unsplash.com/photo-1575361204480-aadea25e6e68?w=800&h=600&fit=crop&auto=format&fit=crop&w=800&q=60'
                ],
                rating: 4.8,
                reviewsCount: 890
            },
        ];
        
        console.log(`Creating ${products.length} products...`);
        
        for (const productData of products) {
            const product = new Product(productData);
            if (productData.discountPrice) {
                product.discountPercentage = Math.round(
                    ((productData.price - productData.discountPrice) / productData.price) * 100
                );
            }
            await product.save();
            console.log(`Created: ${product.name}`);
        }
        
        console.log('\n✅ Database seeded successfully!');
        console.log('\n=== Login Credentials ===');
        console.log('Admin: admin@noon.com / admin123');
        console.log('User: john@example.com / user123');
        console.log('=========================\n');
        console.log('=== Product Categories ===');
        console.log('1. Electronics');
        console.log('2. Fashion');
        console.log('3. Home & Kitchen');
        console.log('4. Sports');
        console.log('=========================\n');
        console.log('Total products created: ' + products.length);
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding database:', error);
        process.exit(1);
    }
}

seedDatabase();