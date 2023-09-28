// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./IMoonwellMToken.sol";

/// @notice Restored from implementation 0x599D4a1538d686814eE11b331EACBBa166D7C41a
/// of 0x628ff693426583D9a7FB391E54366292F509D457
interface IMoonwellWeth is IMoonwellMToken {
  function wethUnwrapper() external view returns (address);
}

