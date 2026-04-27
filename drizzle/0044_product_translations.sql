CREATE TABLE `product_translations` (
  `product_id` TEXT NOT NULL,
  `locale` TEXT NOT NULL,
  `title` TEXT,
  `description` TEXT,
  `meta_title` TEXT,
  `meta_description` TEXT,
  `created_at` TEXT DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`product_id`, `locale`),
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
