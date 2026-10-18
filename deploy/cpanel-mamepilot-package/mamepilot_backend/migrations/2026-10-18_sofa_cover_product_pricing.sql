-- Store sofa-cover-specific sale prices, including variable cushion sizes.
ALTER TABLE `products`
  ADD COLUMN IF NOT EXISTS `sofa_cover_pricing` LONGTEXT NULL;