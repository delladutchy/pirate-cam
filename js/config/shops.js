// LOCAL SURF SHOPS shown in the Shop view. One entry per shop; the page lays them out in a
// square-tile grid, so adding a shop (or, later, a partner) is a config change only.
//  - url:  the shop's own official website (verified), opened in a new tab
//  - town: where the shop is, as shown on its tile
//  - logo: the shop's own logo, loaded from the shop's own website (not copied here). If it
//          fails to load, the tile falls back to the shop's name as text.
// No shop here is a sponsor or partner, and nothing on the page says otherwise.
export const shopSection = { title: 'Local Surf Shops', note: 'Independent local shops. Pirate View has no affiliation with them.' };

export const shops = [
  { id: 'dewey-beach-surf-shop', name: 'Dewey Beach Surf Shop', town: 'Dewey Beach, DE', url: 'https://www.deweybeachsurfshop.com/',
    logo: 'https://deweybeachsurfshop.com/cdn/shop/files/Dewey_Beach_Surf_Shop_DBSS_Dewey_Beach_DE.jpg?v=1746197426&width=600' },
  { id: 'k-coast', name: 'K-Coast Surf Shop', town: 'Ocean City, MD', url: 'https://www.kcoast.com/',
    logo: 'https://s3.amazonaws.com/bb-cms/AppData/Websites/1160/Images/ui/logo.svg' },
  { id: 'bethany-surf-shop', name: 'Bethany Surf Shop', town: 'Bethany Beach, DE', url: 'https://www.bethanysurfshop.net/',
    logo: 'https://36e600d29d8f4ab67ac7.cdn6.editmysite.com/uploads/b/36e600d29d8f4ab67ac7d8eec100eaebe6a1f9defb5e58dab92e564e550b12e0/Untitled%20design_1757524827.png?width=600&optimize=medium' },
  { id: 'quiet-storm', name: 'Quiet Storm Surf Shop', town: 'Rehoboth Beach, DE · Ocean City, MD', url: 'https://www.quietstormsurf.com/',
    logo: 'https://www.quietstormsurf.com/images/header_logo.png' },
];
