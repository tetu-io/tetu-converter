// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @dev Adapted from the project LendingContractsV2, LendingDataV2.sol, library SafeRatioMath
library SafeRatioMath {
  function rpow(
    uint256 x,
    uint256 n,
    uint256 base
  ) internal pure returns (uint256 z) {
    assembly {
      switch x
      case 0 {
        switch n
        case 0 {
          z := base
        }
        default {
          z := 0
        }
      }
      default {
        switch mod(n, 2)
        case 0 {
          z := base
        }
        default {
          z := x
        }
        let half := div(base, 2) // for rounding.

        for {
          n := div(n, 2)
        } n {
          n := div(n, 2)
        } {
          let xx := mul(x, x)
          if iszero(eq(div(xx, x), x)) {
            revert(0, 0)
          }
          let xxRound := add(xx, half)
          if lt(xxRound, xx) {
            revert(0, 0)
          }
          x := div(xxRound, base)
          if mod(n, 2) {
            let zx := mul(z, x)
            if and(
            iszero(iszero(x)),
            iszero(eq(div(zx, x), z))
            ) {
              revert(0, 0)
            }
            let zxRound := add(zx, half)
            if lt(zxRound, zx) {
              revert(0, 0)
            }
            z := div(zxRound, base)
          }
        }
      }
    }

    return z;
  }
}
