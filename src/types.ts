/** An offer as published by a source community, before the destination site sees it. */
export type SourceOffer = {
  source: string;
  /** Id inside the source; with `source` it identifies the post across runs. */
  sourceId: string;
  title: string;
  /** The source's outbound link. Usually an affiliate short link: never publish it as is. */
  link: string;
  shop: string | null;
  price: number | null;
  normalPrice: number | null;
  currency: "COP";
  coupon: string | null;
  /** The category the source community chose, by name; null when the source shows none. */
  category: string | null;
  publishedAt: Date;
  endAt: Date | null;
  imageUrl: string | null;
};

/** A community the bot reads. */
export type Source = {
  name: string;
  /**
   * The offers currently listed. `isSeen` lets a source skip the expensive part (opening a post's
   * own page) for posts already decided.
   */
  read(isSeen: (sourceId: string) => boolean): Promise<SourceOffer[]>;
};
