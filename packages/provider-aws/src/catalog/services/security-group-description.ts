/** AWS rule descriptions exclude ampersands, Unicode and control characters. */
export const securityGroupRuleDescriptionPattern =
  "^[A-Za-z0-9 ._:/()#,@\\[\\]+=;{}!$*\\-]+(?![\\s\\S])";
export const securityGroupDescriptionPattern =
  "^[A-Za-z0-9 ._:/()#,@\\[\\]+=&;{}!$*\\-]+(?![\\s\\S])";
