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
  /** What the post says about shipping; false when it says nothing. */
  freeShipping: boolean;
  freeShippingEligible: boolean;
  requiresMailbox: boolean;
  publishedAt: Date;
  endAt: Date | null;
  imageUrl: string | null;
};

/** A community the bot reads. */
export type Source = {
  name: string;
  /**
   * The offers currently listed. `isSeen` and `since` let a source skip the expensive part
   * (opening a post's own page) for posts already decided or older than the policy allows.
   */
  read(context: { isSeen: (sourceId: string) => boolean; since: Date }): Promise<SourceOffer[]>;
};
