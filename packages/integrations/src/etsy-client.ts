import { Product } from '@agentic-commerce/shared';

interface EtsySearchParams {
  query: string;
  maxPrice?: number;
  limit?: number;
  category?: string;
}

export class EtsyClient {
  private apiKey: string | undefined;
  private useRealAPI: boolean;

  constructor() {
    this.apiKey = process.env.ETSY_API_KEY;
    this.useRealAPI = !!this.apiKey && this.apiKey.length > 0;
    
    if (this.useRealAPI) {
      console.log('✅ Etsy API initialized with real API key');
    } else {
      console.log('⚠️  Etsy API using mock data (add ETSY_API_KEY to .env for real products)');
    }
  }

  private mockProducts: Product[] = [
    {
      id: 'mock-1',
      title: 'Handmade Leather Notebook - Brown',
      description: 'Beautiful handcrafted leather notebook with 200 pages',
      price: 35.99,
      currency: 'USD',
      merchant: 'ArtisanLeatherCo',
      merchantId: 'shop-123',
      url: 'https://etsy.com/listing/mock-1',
      imageUrl: 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&h=400&fit=crop',
      category: 'Paper & Party Supplies',
      inStock: true,
    },
    {
      id: 'mock-2',
      title: 'Vintage Style Leather Journal',
      description: 'Antique-looking leather journal',
      price: 42.50,
      currency: 'USD',
      merchant: 'VintageFinds',
      merchantId: 'shop-456',
      url: 'https://etsy.com/listing/mock-2',
      imageUrl: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=400&h=400&fit=crop',
      category: 'Paper & Party Supplies',
      inStock: true,
    },
    {
      id: 'mock-3',
      title: 'Minimalist Leather Notebook',
      description: 'Simple and elegant',
      price: 28.99,
      currency: 'USD',
      merchant: 'MinimalGoods',
      merchantId: 'shop-321',
      url: 'https://etsy.com/listing/mock-3',
      imageUrl: 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=400&h=400&fit=crop',
      category: 'Office Supplies',
      inStock: true,
    },
    {
      id: 'mock-4',
      title: 'Premium Executive Leather Portfolio',
      description: 'Luxury handcrafted leather portfolio with gold accents and premium Italian leather',
      price: 599.99,
      currency: 'USD',
      merchant: 'LuxuryLeatherGoods',
      merchantId: 'shop-789',
      url: 'https://etsy.com/listing/mock-4',
      imageUrl: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=400&h=400&fit=crop',
      category: 'Office & Business',
      inStock: true,
    },
    {
      id: 'mock-5',
      title: 'Custom Engraved Leather Briefcase',
      description: 'Professional leather briefcase with custom engraving and brass hardware',
      price: 749.00,
      currency: 'USD',
      merchant: 'PremiumCrafts',
      merchantId: 'shop-999',
      url: 'https://etsy.com/listing/mock-5',
      imageUrl: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400&h=400&fit=crop',
      category: 'Bags & Purses',
      inStock: true,
    },
    {
      id: 'mock-6',
      title: 'Artisan Leather Travel Set',
      description: 'Complete travel set with passport holder, luggage tags, and travel wallet',
      price: 895.50,
      currency: 'USD',
      merchant: 'GlobalArtisans',
      merchantId: 'shop-555',
      url: 'https://etsy.com/listing/mock-6',
      imageUrl: 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=400&h=400&fit=crop',
      category: 'Travel & Accessories',
      inStock: true,
    },
    {
      id: 'mock-7',
      title: 'Handcrafted Leather Purse - Crossbody',
      description: 'Beautiful handmade leather crossbody purse with adjustable strap',
      price: 89.99,
      currency: 'USD',
      merchant: 'LeatherCraftStudio',
      merchantId: 'shop-111',
      url: 'https://etsy.com/listing/mock-7',
      imageUrl: 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=400&h=400&fit=crop',
      category: 'Bags & Purses',
      inStock: true,
    },
    {
      id: 'mock-8',
      title: 'Vintage Leather Purse - Brown',
      description: 'Classic vintage-style leather purse with brass clasp',
      price: 125.00,
      currency: 'USD',
      merchant: 'VintageLeather',
      merchantId: 'shop-222',
      url: 'https://etsy.com/listing/mock-8',
      imageUrl: 'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=400&h=400&fit=crop',
      category: 'Bags & Purses',
      inStock: true,
    },
    {
      id: 'mock-9',
      title: 'Luxury Designer Leather Purse - Italian Leather',
      description: 'Luxury designer purse made from premium Italian leather, perfect for special occasions',
      price: 349.99,
      currency: 'USD',
      merchant: 'ItalianLeatherCo',
      merchantId: 'shop-333',
      url: 'https://etsy.com/listing/mock-9',
      imageUrl: 'https://via.placeholder.com/300x300?text=Designer+Purse',
      category: 'Bags & Purses',
      inStock: true,
    },
    {
      id: 'mock-10',
      title: 'Luxury Leather Purse - Hand-Stitched',
      description: 'Premium hand-stitched leather purse with gold hardware',
      price: 650.00,
      currency: 'USD',
      merchant: 'LuxuryBags',
      merchantId: 'shop-444',
      url: 'https://etsy.com/listing/mock-10',
      imageUrl: 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=400&h=400&fit=crop',
      category: 'Bags & Purses',
      inStock: true,
    },
    {
      id: 'mock-11',
      title: 'Luxury Artisan Leather Tote Purse',
      description: 'Luxury spacious leather tote purse perfect for everyday use with premium finishes',
      price: 299.99,
      currency: 'USD',
      merchant: 'ArtisanBags',
      merchantId: 'shop-666',
      url: 'https://etsy.com/listing/mock-11',
      imageUrl: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400&h=400&fit=crop',
      category: 'Bags & Purses',
      inStock: true,
    },
    {
      id: 'mock-12',
      title: 'Wireless Bluetooth Headphones - Noise Cancelling',
      description: 'Premium wireless headphones with active noise cancellation and 30-hour battery life',
      price: 199.99,
      currency: 'USD',
      merchant: 'TechAudio',
      merchantId: 'shop-777',
      url: 'https://etsy.com/listing/mock-12',
      imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=400&fit=crop',
      category: 'Electronics',
      inStock: true,
    },
    {
      id: 'mock-13',
      title: 'Ergonomic Office Chair - Mesh Back',
      description: 'Comfortable ergonomic office chair with lumbar support and adjustable height',
      price: 249.99,
      currency: 'USD',
      merchant: 'OfficeComfort',
      merchantId: 'shop-888',
      url: 'https://etsy.com/listing/mock-13',
      imageUrl: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=400&h=400&fit=crop',
      category: 'Office & Business',
      inStock: true,
    },
    {
      id: 'mock-14',
      title: 'Standing Desk Converter - Adjustable Height',
      description: 'Convert any desk to a standing desk with this adjustable height converter',
      price: 179.99,
      currency: 'USD',
      merchant: 'WorkWell',
      merchantId: 'shop-101',
      url: 'https://etsy.com/listing/mock-14',
      imageUrl: 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=400&h=400&fit=crop',
      category: 'Office & Business',
      inStock: true,
    },
    {
      id: 'mock-15',
      title: 'Mechanical Keyboard - RGB Backlit',
      description: 'Premium mechanical keyboard with RGB backlighting and Cherry MX switches',
      price: 129.99,
      currency: 'USD',
      merchant: 'KeyboardPro',
      merchantId: 'shop-202',
      url: 'https://etsy.com/listing/mock-15',
      imageUrl: 'https://via.placeholder.com/300x300?text=Keyboard',
      category: 'Electronics',
      inStock: true,
    },
    {
      id: 'mock-16',
      title: 'Wireless Mouse - Ergonomic Design',
      description: 'Comfortable wireless mouse with ergonomic design and long battery life',
      price: 49.99,
      currency: 'USD',
      merchant: 'TechAccessories',
      merchantId: 'shop-303',
      url: 'https://etsy.com/listing/mock-16',
      imageUrl: 'https://images.unsplash.com/photo-1527814050087-3793815479db?w=400&h=400&fit=crop',
      category: 'Electronics',
      inStock: true,
    },
    {
      id: 'mock-17',
      title: 'Monitor Stand - Bamboo Wood',
      description: 'Elegant bamboo monitor stand with storage drawer and cable management',
      price: 79.99,
      currency: 'USD',
      merchant: 'DeskOrganizers',
      merchantId: 'shop-404',
      url: 'https://etsy.com/listing/mock-17',
      imageUrl: 'https://via.placeholder.com/300x300?text=Monitor+Stand',
      category: 'Office & Business',
      inStock: true,
    },
    {
      id: 'mock-18',
      title: 'Desk Organizer Set - Acrylic',
      description: 'Modern acrylic desk organizer set with compartments for pens, paper clips, and more',
      price: 34.99,
      currency: 'USD',
      merchant: 'OrganizeIt',
      merchantId: 'shop-505',
      url: 'https://etsy.com/listing/mock-18',
      imageUrl: 'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=400&h=400&fit=crop',
      category: 'Office Supplies',
      inStock: true,
    },
    {
      id: 'mock-19',
      title: 'USB-C Hub - 7 Ports',
      description: 'Multi-port USB-C hub with HDMI, USB 3.0, SD card reader, and power delivery',
      price: 59.99,
      currency: 'USD',
      merchant: 'ConnectTech',
      merchantId: 'shop-606',
      url: 'https://etsy.com/listing/mock-19',
      imageUrl: 'https://via.placeholder.com/300x300?text=USB+Hub',
      category: 'Electronics',
      inStock: true,
    },
    {
      id: 'mock-20',
      title: 'Laptop Stand - Aluminum',
      description: 'Lightweight aluminum laptop stand with adjustable height and ventilation',
      price: 39.99,
      currency: 'USD',
      merchant: 'LaptopAccessories',
      merchantId: 'shop-707',
      url: 'https://etsy.com/listing/mock-20',
      imageUrl: 'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=400&h=400&fit=crop',
      category: 'Office & Business',
      inStock: true,
    },
    {
      id: 'mock-21',
      title: 'Webcam - 4K Ultra HD',
      description: 'Professional 4K webcam with auto-focus and built-in microphone',
      price: 149.99,
      currency: 'USD',
      merchant: 'VideoTech',
      merchantId: 'shop-808',
      url: 'https://etsy.com/listing/mock-21',
      imageUrl: 'https://via.placeholder.com/300x300?text=Webcam',
      category: 'Electronics',
      inStock: true,
    },
    {
      id: 'mock-22',
      title: 'Desk Lamp - LED with USB Charging',
      description: 'Modern LED desk lamp with adjustable brightness and USB charging port',
      price: 45.99,
      currency: 'USD',
      merchant: 'LightingSolutions',
      merchantId: 'shop-909',
      url: 'https://etsy.com/listing/mock-22',
      imageUrl: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=400&h=400&fit=crop',
      category: 'Office Supplies',
      inStock: true,
    },
    {
      id: 'mock-23',
      title: 'Cable Management Box - Fabric',
      description: 'Neat cable management box to hide and organize cables under your desk',
      price: 24.99,
      currency: 'USD',
      merchant: 'CableOrganizers',
      merchantId: 'shop-010',
      url: 'https://etsy.com/listing/mock-23',
      imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=400&fit=crop',
      category: 'Office Supplies',
      inStock: true,
    },
    {
      id: 'mock-24',
      title: 'Notebook Set - 3 Pack',
      description: 'Set of 3 premium notebooks with lined pages and durable covers',
      price: 19.99,
      currency: 'USD',
      merchant: 'PaperGoods',
      merchantId: 'shop-111',
      url: 'https://etsy.com/listing/mock-24',
      imageUrl: 'https://via.placeholder.com/300x300?text=Notebooks',
      category: 'Paper & Party Supplies',
      inStock: true,
    },
    {
      id: 'mock-25',
      title: 'Pen Set - Premium Ballpoint',
      description: 'Set of 5 premium ballpoint pens with ergonomic grip and smooth writing',
      price: 14.99,
      currency: 'USD',
      merchant: 'WritingSupplies',
      merchantId: 'shop-212',
      url: 'https://etsy.com/listing/mock-25',
      imageUrl: 'https://images.unsplash.com/photo-1583484963886-cce2dfd93246?w=400&h=400&fit=crop',
      category: 'Office Supplies',
      inStock: true,
    },
    {
      id: 'mock-26',
      title: 'Sticky Notes - Assorted Colors',
      description: 'Pack of 10 pads of sticky notes in assorted colors and sizes',
      price: 12.99,
      currency: 'USD',
      merchant: 'OfficeBasics',
      merchantId: 'shop-313',
      url: 'https://etsy.com/listing/mock-26',
      imageUrl: 'https://via.placeholder.com/300x300?text=Sticky+Notes',
      category: 'Office Supplies',
      inStock: true,
    },
    {
      id: 'mock-27',
      title: 'File Organizer - Desktop',
      description: 'Desktop file organizer with multiple compartments for documents and folders',
      price: 29.99,
      currency: 'USD',
      merchant: 'FileOrganizers',
      merchantId: 'shop-414',
      url: 'https://etsy.com/listing/mock-27',
      imageUrl: 'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=400&h=400&fit=crop',
      category: 'Office Supplies',
      inStock: true,
    },
    {
      id: 'mock-28',
      title: 'Travel Adapter - Universal',
      description: 'Universal travel adapter with USB ports for charging multiple devices',
      price: 32.99,
      currency: 'USD',
      merchant: 'TravelEssentials',
      merchantId: 'shop-515',
      url: 'https://etsy.com/listing/mock-28',
      imageUrl: 'https://images.unsplash.com/photo-1604594849809-dfeddd82fd54?w=400&h=400&fit=crop',
      category: 'Travel & Accessories',
      inStock: true,
    },
    {
      id: 'mock-29',
      title: 'Luggage Tag - Leather',
      description: 'Premium leather luggage tag with clear window for contact information',
      price: 18.99,
      currency: 'USD',
      merchant: 'TravelGear',
      merchantId: 'shop-616',
      url: 'https://etsy.com/listing/mock-29',
      imageUrl: 'https://via.placeholder.com/300x300?text=Luggage+Tag',
      category: 'Travel & Accessories',
      inStock: true,
    },
    {
      id: 'mock-30',
      title: 'Passport Holder - RFID Blocking',
      description: 'Secure passport holder with RFID blocking technology and card slots',
      price: 27.99,
      currency: 'USD',
      merchant: 'SecureTravel',
      merchantId: 'shop-717',
      url: 'https://etsy.com/listing/mock-30',
      imageUrl: 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=400&h=400&fit=crop',
      category: 'Travel & Accessories',
      inStock: true,
    },
    {
      id: 'mock-31',
      title: 'Backpack - Laptop Compartment',
      description: 'Professional backpack with dedicated laptop compartment and multiple pockets',
      price: 89.99,
      currency: 'USD',
      merchant: 'BagWorks',
      merchantId: 'shop-818',
      url: 'https://etsy.com/listing/mock-31',
      imageUrl: 'https://via.placeholder.com/300x300?text=Backpack',
      category: 'Bags & Purses',
      inStock: true,
    },
    // ============================================================================
    // POLICY TESTING PRODUCTS - Strategic price points for testing policies
    // ============================================================================
    // Policy 1: Office Supplies Auto-Approve (max $100)
    {
      id: 'policy-test-1',
      title: 'Office Supplies Bundle - Starter Pack',
      description: 'Complete office starter pack: 5 notebooks, 10 pens, sticky notes, paper clips, stapler',
      price: 45.00,
      currency: 'USD',
      merchant: 'OfficeEssentials',
      merchantId: 'shop-test-1',
      url: 'https://etsy.com/listing/policy-test-1',
      imageUrl: 'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=400&h=400&fit=crop',
      category: 'Office Supplies',
      inStock: true,
    },
    {
      id: 'policy-test-2',
      title: 'Premium Pen & Pencil Set - Executive Collection',
      description: 'Luxury writing set with fountain pen, ballpoint, mechanical pencil, and leather case',
      price: 95.00,
      currency: 'USD',
      merchant: 'LuxuryWriting',
      merchantId: 'shop-test-2',
      url: 'https://etsy.com/listing/policy-test-2',
      imageUrl: 'https://images.unsplash.com/photo-1583484963886-cce2dfd93246?w=400&h=400&fit=crop',
      category: 'Office Supplies',
      inStock: true,
    },
    {
      id: 'policy-test-3',
      title: 'Desk Organization System - Premium',
      description: 'Complete desk organization with file holders, pen organizers, and storage boxes',
      price: 150.00,
      currency: 'USD',
      merchant: 'OfficePro',
      merchantId: 'shop-test-3',
      url: 'https://etsy.com/listing/policy-test-3',
      imageUrl: 'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=400&h=400&fit=crop',
      category: 'Office Supplies',
      inStock: true,
    },
    // Policy 2: Maximum Transaction Limit ($500)
    {
      id: 'policy-test-4',
      title: 'Professional Standing Desk - Electric',
      description: 'Premium electric standing desk with memory settings and cable management',
      price: 399.00,
      currency: 'USD',
      merchant: 'DeskWorks',
      merchantId: 'shop-test-4',
      url: 'https://etsy.com/listing/policy-test-4',
      imageUrl: 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=400&h=400&fit=crop',
      category: 'Office & Business',
      inStock: true,
    },
    {
      id: 'policy-test-5',
      title: 'Executive Office Chair - Leather',
      description: 'Premium leather executive chair with lumbar support and adjustable armrests',
      price: 475.00,
      currency: 'USD',
      merchant: 'ChairMasters',
      merchantId: 'shop-test-5',
      url: 'https://etsy.com/listing/policy-test-5',
      imageUrl: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=400&h=400&fit=crop',
      category: 'Office & Business',
      inStock: true,
    },
    {
      id: 'policy-test-6',
      title: 'Complete Home Office Setup',
      description: 'SHOULD DENY: Desk, chair, monitor stand, and accessories bundle',
      price: 650.00,
      currency: 'USD',
      merchant: 'OfficeSetups',
      merchantId: 'shop-test-6',
      url: 'https://etsy.com/listing/policy-test-6',
      imageUrl: 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=400&h=400&fit=crop',
      category: 'Office & Business',
      inStock: true,
    },
    {
      id: 'policy-test-7',
      title: 'Designer Ergonomic Workstation',
      description: 'SHOULD DENY: Premium workstation with motorized desk, Herman Miller chair, and accessories',
      price: 1299.00,
      currency: 'USD',
      merchant: 'LuxuryOffice',
      merchantId: 'shop-test-7',
      url: 'https://etsy.com/listing/policy-test-7',
      imageUrl: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=400&h=400&fit=crop',
      category: 'Office & Business',
      inStock: true,
    },
    // Edge cases - At limits
    {
      id: 'policy-test-8',
      title: 'Office Supplies - At Category Limit',
      description: 'TEST EDGE CASE: Exactly at $100 Office Supplies limit',
      price: 100.00,
      currency: 'USD',
      merchant: 'EdgeCases',
      merchantId: 'shop-test-8',
      url: 'https://etsy.com/listing/policy-test-8',
      imageUrl: 'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=400&h=400&fit=crop',
      category: 'Office Supplies',
      inStock: true,
    },
    {
      id: 'policy-test-9',
      title: 'Professional Equipment - At Transaction Limit',
      description: 'TEST EDGE CASE: Exactly at $500 transaction limit',
      price: 500.00,
      currency: 'USD',
      merchant: 'EdgeCases',
      merchantId: 'shop-test-9',
      url: 'https://etsy.com/listing/policy-test-9',
      imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=400&fit=crop',
      category: 'Electronics',
      inStock: true,
    },
    // Different categories for testing
    {
      id: 'policy-test-10',
      title: 'Wireless Presentation Remote',
      description: 'Professional presentation remote with laser pointer and USB receiver',
      price: 35.00,
      currency: 'USD',
      merchant: 'TechAccessories',
      merchantId: 'shop-test-10',
      url: 'https://etsy.com/listing/policy-test-10',
      imageUrl: 'https://images.unsplash.com/photo-1527814050087-3793815479db?w=400&h=400&fit=crop',
      category: 'Electronics',
      inStock: true,
    },
    {
      id: 'policy-test-11',
      title: 'Business Travel Set - Leather',
      description: 'Leather travel organizer with passport holder, luggage tag, and cable organizer',
      price: 85.00,
      currency: 'USD',
      merchant: 'TravelPro',
      merchantId: 'shop-test-11',
      url: 'https://etsy.com/listing/policy-test-11',
      imageUrl: 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=400&h=400&fit=crop',
      category: 'Travel & Accessories',
      inStock: true,
    },
    {
      id: 'policy-test-12',
      title: 'Conference Room Webcam - 4K',
      description: 'Professional 4K webcam with wide-angle lens and auto-tracking',
      price: 299.00,
      currency: 'USD',
      merchant: 'VideoConference',
      merchantId: 'shop-test-12',
      url: 'https://etsy.com/listing/policy-test-12',
      imageUrl: 'https://via.placeholder.com/300x300?text=Webcam',
      category: 'Electronics',
      inStock: true,
    },
    // ============================================================================
    // APPROVAL WORKFLOW TESTING - Products that trigger "requires_approval"
    // ============================================================================
    {
      id: 'approval-test-1',
      title: 'Office Supplies - Basic Approval Test $120',
      description: 'REQUIRES APPROVAL: Office supplies bundle just over $100 limit',
      price: 120.00,
      currency: 'USD',
      merchant: 'OfficeSuppliesHub',
      merchantId: 'shop-approval-1',
      url: 'https://etsy.com/listing/approval-test-1',
      imageUrl: 'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=400&h=400&fit=crop',
      category: 'Office Supplies',
      inStock: true,
    },
    {
      id: 'approval-test-2',
      title: 'Office Supplies - Mid-Range $200',
      description: 'REQUIRES APPROVAL: Premium office supplies well over category limit',
      price: 200.00,
      currency: 'USD',
      merchant: 'PremiumOffice',
      merchantId: 'shop-approval-2',
      url: 'https://etsy.com/listing/approval-test-2',
      imageUrl: 'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=400&h=400&fit=crop',
      category: 'Office Supplies',
      inStock: true,
    },
    {
      id: 'approval-test-3',
      title: 'Office Supplies - High-End $350',
      description: 'REQUIRES APPROVAL: Luxury office supplies setup, still under $500 transaction limit',
      price: 350.00,
      currency: 'USD',
      merchant: 'LuxuryOfficeGoods',
      merchantId: 'shop-approval-3',
      url: 'https://etsy.com/listing/approval-test-3',
      imageUrl: 'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=400&h=400&fit=crop',
      category: 'Office Supplies',
      inStock: true,
    },
    {
      id: 'approval-test-4',
      title: 'Premium Desk Accessories Set',
      description: 'REQUIRES APPROVAL: Luxury desk organizer, pen holders, and accessories - Office Supplies over limit',
      price: 175.00,
      currency: 'USD',
      merchant: 'DeskLuxury',
      merchantId: 'shop-approval-4',
      url: 'https://etsy.com/listing/approval-test-4',
      imageUrl: 'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=400&h=400&fit=crop',
      category: 'Office Supplies',
      inStock: true,
    },
    {
      id: 'approval-test-5',
      title: 'Executive Writing Instruments Collection',
      description: 'REQUIRES APPROVAL: Fountain pen set with luxury case - Office Supplies category',
      price: 225.00,
      currency: 'USD',
      merchant: 'ExecutiveWriting',
      merchantId: 'shop-approval-5',
      url: 'https://etsy.com/listing/approval-test-5',
      imageUrl: 'https://images.unsplash.com/photo-1583484963886-cce2dfd93246?w=400&h=400&fit=crop',
      category: 'Office Supplies',
      inStock: true,
    },
    // ============================================================================
    // CLEAR APPROVAL TESTS (Easy to distinguish)
    // ============================================================================
    {
      id: 'clear-approve-1',
      title: '✅ AUTO-APPROVE: Notebooks $25',
      description: 'Should be auto-approved - Office Supplies under $100',
      price: 25.00,
      currency: 'USD',
      merchant: 'QuickOffice',
      merchantId: 'shop-clear-1',
      url: 'https://etsy.com/listing/clear-approve-1',
      imageUrl: 'https://via.placeholder.com/300x300?text=Notebooks',
      category: 'Office Supplies',
      inStock: true,
    },
    {
      id: 'clear-approve-2',
      title: '✅ AUTO-APPROVE: Pens & Pencils $30',
      description: 'Should be auto-approved - Office Supplies under $100',
      price: 30.00,
      currency: 'USD',
      merchant: 'QuickOffice',
      merchantId: 'shop-clear-2',
      url: 'https://etsy.com/listing/clear-approve-2',
      imageUrl: 'https://images.unsplash.com/photo-1583484963886-cce2dfd93246?w=400&h=400&fit=crop',
      category: 'Office Supplies',
      inStock: true,
    },
    {
      id: 'clear-approve-3',
      title: '✅ AUTO-APPROVE: Sticky Notes Bundle $18',
      description: 'Should be auto-approved - Office Supplies under $100',
      price: 18.00,
      currency: 'USD',
      merchant: 'QuickOffice',
      merchantId: 'shop-clear-3',
      url: 'https://etsy.com/listing/clear-approve-3',
      imageUrl: 'https://via.placeholder.com/300x300?text=Sticky+Notes',
      category: 'Office Supplies',
      inStock: true,
    },
    {
      id: 'clear-approve-4',
      title: '✅ APPROVE: Wireless Mouse $45',
      description: 'Should be approved - Electronics under $500',
      price: 45.00,
      currency: 'USD',
      merchant: 'TechQuick',
      merchantId: 'shop-clear-4',
      url: 'https://etsy.com/listing/clear-approve-4',
      imageUrl: 'https://images.unsplash.com/photo-1527814050087-3793815479db?w=400&h=400&fit=crop',
      category: 'Electronics',
      inStock: true,
    },
    {
      id: 'clear-approve-5',
      title: '✅ APPROVE: Monitor Stand $75',
      description: 'Should be approved - Office & Business under $500',
      price: 75.00,
      currency: 'USD',
      merchant: 'DeskSetup',
      merchantId: 'shop-clear-5',
      url: 'https://etsy.com/listing/clear-approve-5',
      imageUrl: 'https://via.placeholder.com/300x300?text=Monitor+Stand',
      category: 'Office & Business',
      inStock: true,
    },
    // ============================================================================
    // CLEAR APPROVAL REQUIRED (Office Supplies over $100)
    // ============================================================================
    {
      id: 'clear-approval-1',
      title: '🟡 NEEDS APPROVAL: Office Chair $250',
      description: 'Requires approval - Office Supplies category, over $100 limit',
      price: 250.00,
      currency: 'USD',
      merchant: 'OfficeSuppliesPlus',
      merchantId: 'shop-clear-approval-1',
      url: 'https://etsy.com/listing/clear-approval-1',
      imageUrl: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=400&h=400&fit=crop',
      category: 'Office Supplies',
      inStock: true,
    },
    {
      id: 'clear-approval-2',
      title: '🟡 NEEDS APPROVAL: Desk Lamp Set $135',
      description: 'Requires approval - Office Supplies category, over $100 limit',
      price: 135.00,
      currency: 'USD',
      merchant: 'OfficeSuppliesPlus',
      merchantId: 'shop-clear-approval-2',
      url: 'https://etsy.com/listing/clear-approval-2',
      imageUrl: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=400&h=400&fit=crop',
      category: 'Office Supplies',
      inStock: true,
    },
    {
      id: 'clear-approval-3',
      title: '🟡 NEEDS APPROVAL: File Cabinet $180',
      description: 'Requires approval - Office Supplies category, over $100 limit',
      price: 180.00,
      currency: 'USD',
      merchant: 'OfficeSuppliesPlus',
      merchantId: 'shop-clear-approval-3',
      url: 'https://etsy.com/listing/clear-approval-3',
      imageUrl: 'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=400&h=400&fit=crop',
      category: 'Office Supplies',
      inStock: true,
    },
    // ============================================================================
    // CLEAR DENIALS (Over $500)
    // ============================================================================
    {
      id: 'clear-deny-1',
      title: '❌ WILL DENY: Laptop $899',
      description: 'Should be denied - Over $500 transaction limit',
      price: 899.00,
      currency: 'USD',
      merchant: 'TechStore',
      merchantId: 'shop-clear-deny-1',
      url: 'https://etsy.com/listing/clear-deny-1',
      imageUrl: 'https://via.placeholder.com/300x300?text=Laptop',
      category: 'Electronics',
      inStock: true,
    },
    {
      id: 'clear-deny-2',
      title: '❌ WILL DENY: Office Suite $750',
      description: 'Should be denied - Over $500 transaction limit',
      price: 750.00,
      currency: 'USD',
      merchant: 'OfficePremium',
      merchantId: 'shop-clear-deny-2',
      url: 'https://etsy.com/listing/clear-deny-2',
      imageUrl: 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=400&h=400&fit=crop',
      category: 'Office & Business',
      inStock: true,
    },
    {
      id: 'clear-deny-3',
      title: '❌ WILL DENY: Conference System $1200',
      description: 'Should be denied - Way over $500 transaction limit',
      price: 1200.00,
      currency: 'USD',
      merchant: 'ConferencePro',
      merchantId: 'shop-clear-deny-3',
      url: 'https://etsy.com/listing/clear-deny-3',
      imageUrl: 'https://via.placeholder.com/300x300?text=Conference',
      category: 'Electronics',
      inStock: true,
    },
    {
      id: 'mock-jewelry-1',
      title: 'Silver Pendant Necklace - Handcrafted',
      description: 'Beautiful handcrafted silver pendant necklace with intricate design',
      price: 89.99,
      currency: 'USD',
      merchant: 'SilverCraft',
      merchantId: 'shop-jewelry-1',
      url: 'https://etsy.com/listing/jewelry-1',
      imageUrl: 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&h=400&fit=crop',
      category: 'Jewelry',
      inStock: true,
    },
    {
      id: 'mock-jewelry-2',
      title: 'Gold Plated Ring - Vintage Style',
      description: 'Elegant gold plated ring with vintage-inspired design, perfect for special occasions',
      price: 125.00,
      currency: 'USD',
      merchant: 'VintageJewels',
      merchantId: 'shop-jewelry-2',
      url: 'https://etsy.com/listing/jewelry-2',
      imageUrl: 'https://via.placeholder.com/300x300?text=Ring',
      category: 'Jewelry',
      inStock: true,
    },
    {
      id: 'mock-jewelry-3',
      title: 'Pearl Bracelet - Classic Design',
      description: 'Classic pearl bracelet with adjustable clasp, timeless elegance',
      price: 149.99,
      currency: 'USD',
      merchant: 'PearlBoutique',
      merchantId: 'shop-jewelry-3',
      url: 'https://etsy.com/listing/jewelry-3',
      imageUrl: 'https://images.unsplash.com/photo-1611591437281-460bfbe1220a?w=400&h=400&fit=crop',
      category: 'Jewelry',
      inStock: true,
    },
    {
      id: 'mock-jewelry-4',
      title: 'Diamond Stud Earrings - Sterling Silver',
      description: 'Stunning diamond stud earrings set in sterling silver, perfect for everyday wear',
      price: 199.99,
      currency: 'USD',
      merchant: 'DiamondCraft',
      merchantId: 'shop-jewelry-4',
      url: 'https://etsy.com/listing/jewelry-4',
      imageUrl: 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=400&h=400&fit=crop',
      category: 'Jewelry',
      inStock: true,
    },
    {
      id: 'mock-jewelry-5',
      title: 'Rose Gold Chain Necklace',
      description: 'Delicate rose gold chain necklace with adjustable length, modern and elegant',
      price: 79.99,
      currency: 'USD',
      merchant: 'RoseGoldJewels',
      merchantId: 'shop-jewelry-5',
      url: 'https://etsy.com/listing/jewelry-5',
      imageUrl: 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&h=400&fit=crop',
      category: 'Jewelry',
      inStock: true,
    },
  ];

  async searchProducts(params: EtsySearchParams): Promise<Product[]> {
    try {
      console.log('EtsyClient.searchProducts called with params:', JSON.stringify(params));
      
      // Use real Etsy API if available
      if (this.useRealAPI && this.apiKey) {
        try {
          return await this.searchEtsyAPI(params);
        } catch (error) {
          console.error('Etsy API error, falling back to mock data:', error);
          // Fall through to mock data
        }
      }

      // Mock data fallback
      let results = [...this.mockProducts];
      console.log(`Starting with ${results.length} mock products`);

      if (params.query && typeof params.query === 'string' && params.query.trim().length > 0) {
        // Normalize query - handle common typos
        const normalizedQuery = params.query.toLowerCase()
          .replace(/jewlry/g, 'jewelry')
          .replace(/jewellery/g, 'jewelry');
        
        const queryWords = normalizedQuery.split(' ').filter(w => w.length > 0);
        console.log(`Filtering products with query words: ${queryWords.join(', ')}`);
        
        results = results.filter(p => {
          const titleLower = p.title.toLowerCase();
          const descLower = p.description.toLowerCase();
          const categoryLower = p.category.toLowerCase();
          // Match if ANY query word appears in title, description, or category
          const matches = queryWords.some(word => 
            titleLower.includes(word) || 
            descLower.includes(word) || 
            categoryLower.includes(word)
          );
          if (matches) {
            console.log(`Product "${p.title}" matches query "${params.query}"`);
          }
          return matches;
        });
        console.log(`After filtering: ${results.length} products match`);
      } else {
        console.log('No query provided, returning all products');
      }

      if (params.maxPrice) {
        results = results.filter(p => p.price <= params.maxPrice!);
        console.log(`After price filter: ${results.length} products`);
      }

      if (params.category) {
        const categoryLower = params.category.toLowerCase();
        results = results.filter(p => p.category.toLowerCase() === categoryLower);
        console.log(`After category filter (${params.category}): ${results.length} products`);
      }

      const finalResults = results.slice(0, params.limit || 10);
      console.log(`Returning ${finalResults.length} products (limit: ${params.limit || 10})`);
      return finalResults;
    } catch (error: any) {
      console.error('Error in searchProducts:', error);
      console.error('Error stack:', error.stack);
      throw error;
    }
  }

  private async searchEtsyAPI(params: EtsySearchParams): Promise<Product[]> {
    const url = new URL('https://openapi.etsy.com/v3/application/listings/active');
    url.searchParams.set('keywords', params.query);
    url.searchParams.set('limit', String(params.limit || 10));
    
    if (params.maxPrice) {
      url.searchParams.set('max_price', String(params.maxPrice * 100)); // Etsy uses cents
    }

    const response = await fetch(url.toString(), {
      headers: {
        'x-api-key': this.apiKey!,
      },
    });

    if (!response.ok) {
      throw new Error(`Etsy API error: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();
    
    // Transform Etsy API response to our Product format
    return data.results.map((listing: any) => ({
      id: String(listing.listing_id),
      title: listing.title,
      description: listing.description || '',
      price: listing.price.amount / listing.price.divisor,
      currency: listing.price.currency_code,
      merchant: listing.shop?.shop_name || 'Unknown Shop',
      merchantId: String(listing.shop_id),
      url: listing.url,
      imageUrl: listing.images?.[0]?.url_570xN || '',
      category: listing.taxonomy_path?.[0] || 'General',
      inStock: listing.state === 'active',
    }));
  }

  async getProductById(id: string): Promise<Product | null> {
    return this.mockProducts.find(p => p.id === id) || null;
  }
}
