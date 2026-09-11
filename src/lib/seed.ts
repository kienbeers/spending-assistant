// Dữ liệu khởi tạo lần đầu. Từ khóa viết KHÔNG DẤU, chữ thường (khớp nguyên từ).
// Tránh từ quá chung dễ trùng nghĩa sau khi bỏ dấu: "cho" (chợ/cho), "quan" (quần/quán),
// "thuong" (thưởng/thường), "be" (Be/bé)...

export type WalletKind = "bank" | "ewallet" | "cash" | "credit";
export type CategoryType = "expense" | "income";

export const SEED_WALLETS: {
  name: string;
  kind: WalletKind;
  aliases: string;
  color: string;
  isDefault: boolean;
}[] = [
  { name: "MB Bank", kind: "bank", aliases: "mb, mbbank, mb bank", color: "#2563eb", isDefault: false },
  { name: "SHB", kind: "bank", aliases: "shb", color: "#ea580c", isDefault: false },
  { name: "Ví MoMo", kind: "ewallet", aliases: "momo, mm", color: "#c026d3", isDefault: false },
  { name: "Tiền mặt", kind: "cash", aliases: "tien mat, tm, cash", color: "#16a34a", isDefault: true },
];

export const SEED_CATEGORIES: {
  name: string;
  type: CategoryType;
  icon: string;
  keywords: string[];
}[] = [
  {
    name: "Ăn uống",
    type: "expense",
    icon: "🍜",
    keywords: [
      "an sang", "an trua", "an toi", "an vat", "an dem", "do an", "com", "pho", "bun",
      "banh mi", "lau", "nuong", "nha hang", "grabfood", "shopeefood", "baemin", "kfc", "lotteria",
    ],
  },
  {
    name: "Cà phê & trà sữa",
    type: "expense",
    icon: "☕",
    keywords: [
      "cafe", "ca phe", "coffee", "cf", "tra sua", "tra chanh", "nuoc ep", "sinh to", "nuoc mia",
      "highlands", "phuc long", "starbucks", "katinat", "cong ca phe", "trung nguyen", "mixue",
    ],
  },
  {
    name: "Đi chợ & siêu thị",
    type: "expense",
    icon: "🛒",
    keywords: [
      "di cho", "sieu thi", "winmart", "bach hoa xanh", "bhx", "coopmart", "co.op", "aeon",
      "lotte mart", "circle k", "gs25", "ministop", "rau", "thit", "trung ga", "gao",
    ],
  },
  {
    name: "Di chuyển",
    type: "expense",
    icon: "🛵",
    keywords: [
      "grab", "xanh sm", "gojek", "taxi", "xang", "do xang", "gui xe", "ve xe", "sua xe", "rua xe",
      "thay dau", "vetc", "bus", "xe om", "ve may bay", "ve tau",
    ],
  },
  {
    name: "Nhà ở",
    type: "expense",
    icon: "🏠",
    keywords: ["tien nha", "thue nha", "tien phong", "phi quan ly", "sua nha"],
  },
  {
    name: "Hóa đơn",
    type: "expense",
    icon: "💡",
    keywords: [
      "tien dien", "dien", "tien nuoc", "internet", "wifi", "cap quang", "fpt", "viettel", "vnpt",
      "nap dt", "nap dien thoai", "the cao", "4g", "5g", "cuoc dien thoai",
    ],
  },
  {
    name: "Mua sắm",
    type: "expense",
    icon: "🛍️",
    keywords: [
      "shopee", "lazada", "tiki", "tiktok shop", "quan ao", "ao khoac", "ao thun", "giay", "dep",
      "tui xach", "my pham", "uniqlo", "do dung",
    ],
  },
  {
    name: "Giải trí",
    type: "expense",
    icon: "🎬",
    keywords: [
      "xem phim", "cgv", "lotte cinema", "netflix", "spotify", "youtube premium", "game",
      "karaoke", "bida", "nhau", "di nhau", "du lich", "khach san",
    ],
  },
  {
    name: "Sức khỏe",
    type: "expense",
    icon: "💊",
    keywords: ["thuoc", "kham benh", "benh vien", "nha khoa", "gym", "yoga", "vitamin"],
  },
  {
    name: "Học tập",
    type: "expense",
    icon: "📚",
    keywords: ["sach", "hoc phi", "khoa hoc", "udemy", "ielts"],
  },
  {
    name: "Hiếu hỉ & quà",
    type: "expense",
    icon: "🎁",
    keywords: [
      "dam cuoi", "mung cuoi", "an cuoi", "dam hieu", "phung vieng", "sinh nhat", "qua tang",
      "mua qua", "tang qua",
    ],
  },
  {
    name: "Gia đình",
    type: "expense",
    icon: "🏡",
    keywords: ["bo me", "gui me", "gui bo", "cho me", "cho bo", "bien ong ba", "sua cho con", "ta bim"],
  },
  {
    name: "Lãi vay",
    type: "expense",
    icon: "🏦",
    keywords: ["lai vay", "lai ngoai", "tien lai vay"],
  },
  { name: "Khác", type: "expense", icon: "📦", keywords: [] },
  { name: "Lương", type: "income", icon: "💰", keywords: ["luong", "salary"] },
  {
    name: "Thưởng",
    type: "income",
    icon: "🎉",
    keywords: ["tien thuong", "thuong tet", "bonus", "hoa hong"],
  },
  {
    name: "Được cho & lì xì",
    type: "income",
    icon: "🧧",
    keywords: ["li xi", "mung tuoi", "duoc cho", "duoc tang", "me cho", "bo cho"],
  },
  {
    name: "Thu nhập khác",
    type: "income",
    icon: "💵",
    keywords: ["hoan tien", "cashback", "ban do", "thu no", "tien lai", "lai suat", "nhan tien", "freelance"],
  },
];
