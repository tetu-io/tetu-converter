[![codecov](https://codecov.io/gh/tetu-io/tetu-converter/branch/master/graph/badge.svg?token=U454YZ3I5G)](https://codecov.io/gh/tetu-io/tetu-converter)

Tetu.io is a collaboration between developers and investors around the whole world to create the best
DeFi product out there.

## Installation

Run `npm install`

Create .env file from .env.example

## Links

Web: https://tetu.io/

Docs: https://docs.tetu.io/

Discord: https://discord.gg/DSUKVEYuax

Twitter: https://twitter.com/tetu_io

## Deployed contracts, Polygon

### Proxy contracts
    controller: 0x2df21e2a115fcB3d850Fbc67237571bBfB566e99
    tetuConverter: 0x5E1226f7e743cA56537B3fab0C1A9ea2FAe7BAb1
    borrowManager: 0xC5690F7063eb60D474Bcdb38b60EbF4C3a8Ece3C
    debtMonitor: 0xAF2DEcd5Ad64d833Be5Bbd4D7eB16fEA57D473a2
    swapManager: 0x59D34F2fA054369EbCe4ad244f4ab3a9F51700f3
    keeper: 0x3fFaF005413DC76D8e6964066D3E9Bd2303d5905

### Ordinal (not proxy) contracts
    priceOracle: 0x8E24157016b0Ea7693A3BB8A62c585F5B77828ec

#### AAVE v3
    Platform adapter: 0xEE97B67609cD92dAD3772bC9c0A672c38EFfAF6c
    Converter for normal mode: 0x605676c1eAFe7b6e5F28388712722cB2A05AA4c9
    Converter for emode: 0xdB4957d7143Bb29187c017C61A63A31CC7a2C5fd

#### AAVE-TWO
    Platform adapter: 0x11d108C51486CC5AE8F099D5C0eD2Ec1294e5573
    Converters: 0x8c03474eccD1d75990a9D2934853e605A98FF1a9

#### DForce
    Platform adapter: 0xb86FC63f7409Ffde027Cb75CD2A424E85F6EFF42
    Converters: 0xF89a164072182C8114C860ccfd241B8011cDc5B4

#### Compound3
    Platform adapter: 0x16f31FdbB251844624886EeC1bCaA452Cde4a135
    Converters: 0x2F0978500bB292923f707e4f8E8Be3E9830d653f

## How to whitelist a user
ConverterController.setWhitelistValues([USER_ADDRESS], true)
  
governance only 

## How to freeze a platform adapter
IPlatformAdapter([PLATFORM_ADAPTER_ADDRESS]).setFrozen(true)

governance only