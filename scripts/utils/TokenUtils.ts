import { ethers } from 'hardhat';
import { IERC20__factory, IERC20Metadata__factory, IWmatic__factory } from '../../typechain';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
// import { MaticAddresses } from '../addresses/MaticAddresses';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {deal} from "hardhat-deal";
import {Misc} from "./Misc";
import {DeployerUtilsLocal} from "./DeployerUtilsLocal";

const {expect} = chai;
chai.use(chaiAsPromised);

export class TokenUtils {
  public static async balanceOf(tokenAddress: string, account: string): Promise<BigNumber> {
    return IERC20__factory.connect(tokenAddress, ethers.provider).balanceOf(account);
  }

  public static async totalSupply(tokenAddress: string): Promise<BigNumber> {
    return IERC20__factory.connect(tokenAddress, ethers.provider).totalSupply();
  }

  public static async approve(tokenAddress: string, signer: SignerWithAddress, spender: string, amount: string) {
    console.log('approve', await TokenUtils.tokenSymbol(tokenAddress), amount);
    return IERC20__factory.connect(tokenAddress, signer).approve(spender, BigNumber.from(amount));
  }

  /*  public static async approveNFT(tokenAddress: string, signer: SignerWithAddress, spender: string, id: string) {
      console.log('approve', await TokenUtils.tokenSymbol(tokenAddress), id);
      await TokenUtils.checkNftBalance(tokenAddress, signer.address, id);
      return IERC20__factory.connect(tokenAddress, signer).approve(spender, id);
    }*/

  public static async allowance(tokenAddress: string, signer: SignerWithAddress, spender: string): Promise<BigNumber> {
    return IERC20__factory.connect(tokenAddress, signer).allowance(signer.address, spender);
  }

  public static async transfer(tokenAddress: string, signer: SignerWithAddress, destination: string, amount: string, silent?: boolean) {
    if (!silent) {
      console.log('TokenUtils.transfer', await TokenUtils.tokenSymbol(tokenAddress), amount);
      console.log("TokenUtils.balance", await IERC20__factory.connect(tokenAddress, signer).balanceOf(signer.address));
    }
    return IERC20__factory.connect(tokenAddress, signer).transfer(destination, BigNumber.from(amount), {gasLimit: 19_000_000})
  }

  public static async decimals(tokenAddress: string): Promise<number> {
    return IERC20Metadata__factory.connect(tokenAddress, ethers.provider).decimals();
  }

  public static async tokenName(tokenAddress: string): Promise<string> {
    return IERC20Metadata__factory.connect(tokenAddress, ethers.provider).name();
  }

  public static async tokenSymbol(tokenAddress: string): Promise<string> {
    return IERC20Metadata__factory.connect(tokenAddress, ethers.provider).symbol();
  }

  public static async checkBalance(tokenAddress: string, account: string, amount: string) {
    const bal = await TokenUtils.balanceOf(tokenAddress, account);
    expect(bal.gt(BigNumber.from(amount))).is.eq(true, 'Balance less than amount');
    return bal;
  }

  public static async getToken(token: string, to: string, amount?: BigNumber, silent?: boolean) {
    const currentBalance = await IERC20__factory.connect(token, await Misc.impersonate(to)).balanceOf(to);
    await deal(token, to, currentBalance.add(amount || 0));

    const start = Date.now();
    if (!silent) {
      console.log('deal token', token, amount?.toString());
    }

    if (token.toLowerCase() === await DeployerUtilsLocal.getNetworkTokenAddress()) {
      await IWmatic__factory.connect(token, await Misc.impersonate(to)).deposit({value: amount});
      return amount;
    }

    if (!silent) {
      TokenUtils.printDuration('getToken completed', start);
    }
  }

  public static printDuration(text: string, start: number) {
    console.info('>>>' + text, ((Date.now() - start) / 1000).toFixed(1), 'sec');
  }

}
