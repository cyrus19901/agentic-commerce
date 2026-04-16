/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/agentic_escrow.json`.
 */
export type AgenticEscrow = {
  "address": "5k5ZZHiar9aheemskLMc54Jx5niwKLmKMNySunsCyj9F",
  "metadata": {
    "name": "agenticEscrow",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Production-grade escrow program for agentic payments settlement"
  },
  "instructions": [
    {
      "name": "cancel",
      "discriminator": [
        232,
        219,
        223,
        41,
        219,
        236,
        220,
        190
      ],
      "accounts": [
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "escrow.payer",
                "account": "escrowAccount"
              },
              {
                "kind": "account",
                "path": "escrow.nonce",
                "account": "escrowAccount"
              }
            ]
          }
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "deposit",
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "escrow.payer",
                "account": "escrowAccount"
              },
              {
                "kind": "account",
                "path": "escrow.nonce",
                "account": "escrowAccount"
              }
            ]
          }
        },
        {
          "name": "escrowTokenAccount",
          "writable": true
        },
        {
          "name": "payerTokenAccount",
          "writable": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "initializeEscrow",
      "discriminator": [
        243,
        160,
        77,
        153,
        11,
        92,
        48,
        209
      ],
      "accounts": [
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "payer"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "escrowTokenAccount",
          "writable": true,
          "signer": true
        },
        {
          "name": "mint"
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "payee"
        },
        {
          "name": "authority"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "expiresAt",
          "type": "i64"
        },
        {
          "name": "nonce",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "refund",
      "discriminator": [
        2,
        96,
        183,
        251,
        63,
        208,
        46,
        46
      ],
      "accounts": [
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "escrow.payer",
                "account": "escrowAccount"
              },
              {
                "kind": "account",
                "path": "escrow.nonce",
                "account": "escrowAccount"
              }
            ]
          }
        },
        {
          "name": "escrowTokenAccount",
          "writable": true
        },
        {
          "name": "payerTokenAccount",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "release",
      "discriminator": [
        253,
        249,
        15,
        206,
        28,
        127,
        193,
        241
      ],
      "accounts": [
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "escrow.payer",
                "account": "escrowAccount"
              },
              {
                "kind": "account",
                "path": "escrow.nonce",
                "account": "escrowAccount"
              }
            ]
          }
        },
        {
          "name": "escrowTokenAccount",
          "writable": true
        },
        {
          "name": "payeeTokenAccount",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "escrowAccount",
      "discriminator": [
        36,
        69,
        48,
        18,
        128,
        225,
        125,
        135
      ]
    }
  ],
  "events": [
    {
      "name": "escrowCancelled",
      "discriminator": [
        98,
        241,
        195,
        122,
        213,
        0,
        162,
        161
      ]
    },
    {
      "name": "escrowCreated",
      "discriminator": [
        70,
        127,
        105,
        102,
        92,
        97,
        7,
        173
      ]
    },
    {
      "name": "escrowFunded",
      "discriminator": [
        228,
        243,
        166,
        74,
        22,
        167,
        157,
        244
      ]
    },
    {
      "name": "escrowRefunded",
      "discriminator": [
        132,
        209,
        49,
        109,
        135,
        138,
        28,
        81
      ]
    },
    {
      "name": "escrowReleased",
      "discriminator": [
        131,
        7,
        138,
        104,
        166,
        190,
        113,
        112
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidAmount",
      "msg": "Invalid amount: must be greater than zero"
    },
    {
      "code": 6001,
      "name": "invalidExpiry",
      "msg": "Invalid expiry: must be in the future"
    },
    {
      "code": 6002,
      "name": "expired",
      "msg": "Escrow has expired"
    },
    {
      "code": 6003,
      "name": "invalidStatus",
      "msg": "Invalid escrow status for this operation"
    },
    {
      "code": 6004,
      "name": "unauthorizedPayer",
      "msg": "Unauthorized: signer is not the expected payer"
    },
    {
      "code": 6005,
      "name": "unauthorizedAuthority",
      "msg": "Unauthorized: signer is not the platform authority"
    },
    {
      "code": 6006,
      "name": "unauthorizedCancel",
      "msg": "Unauthorized: only payer, authority, or expired escrow can be cancelled"
    }
  ],
  "types": [
    {
      "name": "escrowAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "payee",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "escrowTokenAccount",
            "type": "pubkey"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "escrowStatus"
              }
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "fundedAt",
            "type": "i64"
          },
          {
            "name": "settledAt",
            "type": "i64"
          },
          {
            "name": "depositSignature",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "settleSignature",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "nonce",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "escrowCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "escrow",
            "type": "pubkey"
          },
          {
            "name": "cancelledBy",
            "type": "pubkey"
          },
          {
            "name": "settledAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "escrowCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "escrow",
            "type": "pubkey"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "payee",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "escrowFunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "escrow",
            "type": "pubkey"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "fundedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "escrowRefunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "escrow",
            "type": "pubkey"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "settledAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "escrowReleased",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "escrow",
            "type": "pubkey"
          },
          {
            "name": "payee",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "settledAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "escrowStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "created"
          },
          {
            "name": "funded"
          },
          {
            "name": "released"
          },
          {
            "name": "refunded"
          },
          {
            "name": "cancelled"
          },
          {
            "name": "expired"
          }
        ]
      }
    }
  ]
};
