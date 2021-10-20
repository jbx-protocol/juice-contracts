import { config } from 'hardhat';
import chai from 'chai';
import fs from 'fs';
import glob from 'glob';

import { deployMockContract } from '@ethereum-waffle/mock-contract';

import '@nomiclabs/hardhat-ethers';
import { BigNumber, Contract, utils, constants, Signer } from 'ethers';
import { BlockTag, Block } from '@ethersproject/abstract-provider';
import hre from 'hardhat';

import unit from './unit';
import integration from './integration';
import { Provider } from '@ethersproject/providers';
import { BigNumberish } from '@ethersproject/bignumber';

describe('Juicebox', async function () {
  before(async function () {
    // Bind a reference to the deployer address and an array of other addresses to `this`.
    [this.deployer, ...this.addrs] = await hre.ethers.getSigners();

    // Bind the ability to manipulate time to `this`.
    // Bind a function that gets the current block's timestamp.
    this.getTimestampFn = async (block: BlockTag | string | Promise<BlockTag | string>) => {
      return BigNumber.from((await hre.ethers.provider.getBlock(block || 'latest')).timestamp);
    };

    // Binds a function that sets a time mark that is taken into account while fastforward.
    this.setTimeMarkFn = async (blockNumber: string) => {
      this.timeMark = await this.getTimestampFn(blockNumber);
    };

    // Binds a function that fastforward a certain amount from the beginning of the test, or from the latest time mark if one is set.
    this.fastforwardFn = async (seconds) => {
      const now = await this.getTimestampFn();
      const timeSinceTimemark = now.sub(this.timeMark);
      const fastforwardAmount = seconds.toNumber() - timeSinceTimemark;
      this.timeMark = now.add(fastforwardAmount);

      // Subtract away any time that has already passed between the start of the test,
      // or from the last fastforward, from the provided value.
      await hre.ethers.provider.send('evm_increaseTime', [fastforwardAmount]);
      // Mine a block.
      await hre.ethers.provider.send('evm_mine');
    };

    // Bind a reference to a function that can deploy mock contracts from an abi.
    this.deployMockContractFn = (abi) => deployMockContract(this.deployer, abi);

    // Bind a reference to a function that can deploy mock local contracts from names.
    this.deployMockLocalContractFn = async (mockContractName) => {
      // Deploy mock contracts.
      return this.deployMockContractFn(this.readContractAbi(mockContractName));
    };

    // Bind a reference to a function that can deploy a contract on the local network.
    this.deployContractFn = async (contractName: string, args: any[] = []) => {
      const artifacts = await hre.ethers.getContractFactory(contractName);
      return artifacts.deploy(...args);
    };

    // Bind a function that mocks a contract function's execution with the provided args to return the provided values.
    this.mockFn = async ({ mockContract, fn, args, returns = [] }) => {
      // The `args` can be a function or an array.
      const normalizedArgs = args && typeof args === 'function' ? await args() : args;

      // The `returns` value can be a function or an array.
      const normalizedReturns = typeof returns === 'function' ? await returns() : returns;

      // Get a reference to the mock.
      const mock = mockContract.mock[fn];

      // If args were provided, make the the mock only works if invoked with the provided args.
      if (normalizedArgs) mock.withArgs(...normalizedArgs);

      // Set its return value.
      await mock.returns(...normalizedReturns);
    };

    // Reads a contract.
    this.readContractAbi = (contractName: string) => {
      const files = glob.sync(
        `${config.paths.artifacts}/contracts/**/${contractName}.sol/${contractName}.json`,
        {},
      );
      if (files.length == 0) {
        throw 'No files found!';
      }
      if (files.length > 1) {
        throw 'Multiple files found!';
      }
      return JSON.parse(fs.readFileSync(files[0]).toString()).abi;
    };

    // Bind a function that executes a transaction on a contract.
    this.executeFn = async ({
      caller,
      contract,
      contractName,
      contractAddress,
      fn,
      args = [],
      value = 0,
      events = [],
      revert,
    }: {
      caller?: Provider | Signer | undefined;
    }) => {
      // Args can be either a function or an array.
      const normalizedArgs = typeof args === 'function' ? await args() : args;

      let contractInternal;
      if (contractName) {
        if (contract) {
          throw 'You can only provide a contract name or contract object.';
        }
        if (!contractAddress) {
          throw 'You must provide a contract address with a contract name.';
        }

        contractInternal = new Contract(
          contractAddress,
          this.readContractAbi(contractName),
          caller,
        );
      } else {
        contractInternal = contract;
      }

      // Save the promise that is returned.
      const promise = contractInternal.connect(caller)[fn](...normalizedArgs, { value });

      // If a revert message is passed in, check to see if it was thrown.
      if (revert) {
        await chai.expect(promise).to.be.revertedWith(revert);
        return;
      }

      // Await the promise.
      const tx = await promise;

      // Wait for a block to get mined.
      await tx.wait();

      // Set the time mark of this function.
      await this.setTimeMarkFn(tx.blockNumber);

      // Return if there are no events.
      if (events.length === 0) return;

      // Check for events.
      events.forEach((event) =>
        chai
          .expect(tx)
          .to.emit(contract, event.name)
          .withArgs(...event.args),
      );
    };

    this.bindContractFn = async ({
      address,
      contractName,
      signerOrProvider,
    }: {
      address: string;
      contractName: string;
    }) => {
      return new Contract(address, this.readContractAbi(contractName), signerOrProvider);
    };

    // Bind a function that sends funds from one address to another.
    this.sendTransactionFn = async ({
      from,
      to,
      value,
      revert,
      events,
    }: {
      from: Signer;
      to: string;
      value: BigNumberish;
    }) => {
      // Transfer the funds.
      const promise = from.sendTransaction({
        to,
        value,
      });

      // If a revert message is passed in, check to see if it was thrown.
      if (revert) {
        await chai.expect(promise).to.be.revertedWith(revert);
        return;
      }

      // Await the promise.
      const tx = await promise;

      // Wait for a block to get mined.
      await tx.wait();

      // Set the time mark of this function.
      await this.setTimeMarkFn(tx.blockNumber);

      // Return if there are no events.
      if (events.length === 0) return;

      // Check for events.
      events.forEach((event) =>
        chai
          .expect(tx)
          .to.emit(event.contract, event.name)
          .withArgs(...event.args),
      );
    };

    // Bind a function that checks if a contract getter equals an expected value.
    this.checkFn = async ({ caller, contract, fn, args, expect, plusMinus }) => {
      const storedVal = await contract.connect(caller)[fn](...args);
      if (plusMinus) {
        console.log({
          storedVal,
          diff: storedVal.sub(expect),
          plusMinus: plusMinus.amount,
        });
        chai.expect(storedVal.lte(expect.add(plusMinus.amount))).to.equal(true);
        chai.expect(storedVal.gte(expect.sub(plusMinus.amount))).to.equal(true);
      } else {
        chai.expect(storedVal).to.deep.equal(expect);
      }
    };

    // Binds a function that makes sure the provided address has the balance
    this.verifyBalanceFn = async ({ address, expect, plusMinus }: { address: string }) => {
      const storedVal = await hre.ethers.provider.getBalance(address);
      if (plusMinus) {
        console.log({
          storedVal,
          diff: storedVal.sub(expect),
          plusMinus: plusMinus.amount,
        });
        chai.expect(storedVal.lte(expect.add(plusMinus.amount))).to.equal(true);
        chai.expect(storedVal.gte(expect.sub(plusMinus.amount))).to.equal(true);
      } else {
        chai.expect(storedVal).to.deep.equal(expect);
      }
    };

    // Binds a function that gets the balance of an address.
    this.getBalanceFn = (address: string) => hre.ethers.provider.getBalance(address);

    // Binds the standard expect function.
    this.expectFn = chai.expect;

    // Bind some constants.

    this.constants = {
      AddressZero: constants.AddressZero,
      MaxUint256: constants.MaxUint256,
      MaxInt256: BigNumber.from(2).pow(255).sub(1),
      MaxUint24: BigNumber.from(2).pow(24).sub(1),
      MaxUint16: BigNumber.from(2).pow(16).sub(1),
      MaxUint8: BigNumber.from(2).pow(8).sub(1),
    };

    // Bind function that gets a random big number.
    this.randomBigNumberFn = ({
      min = BigNumber.from(0),
      max = this.constants.MaxUint256,
      precision = 10000000,
      favorEdges = true,
    } = {}) => {
      // To test an edge condition, return the min or the max and the numbers around them more often.
      // Return the min or the max or the numbers around them 50% of the time.
      if (favorEdges && Math.random() < 0.5) {
        const r = Math.random();
        if (r <= 0.25 && min.add(1).lt(max)) return min.add(1);
        if (r >= 0.75 && max.sub(1).gt(min)) return max.sub(1);
        // return the min 50% of the time.
        return r < 0.5 ? min : max;
      }

      const base = max.sub(min);
      const randomInRange = base.gt(precision)
        ? base.div(precision).mul(BigNumber.from(Math.floor(Math.random() * precision)))
        : base.mul(BigNumber.from(Math.floor(Math.random() * precision))).div(precision);

      return randomInRange.add(min);
    };

    // Bind a function that gets a random address.
    this.randomAddressFn = ({ exclude = [] }: {exclude?: string[]} = {}) => {
      // To test an edge condition, pick the same address more likely than not.
      // return address0 50% of the time.
      const candidate: string =
        Math.random() < 0.5
          ? this.addrs[0].address
          : this.addrs[Math.floor(Math.random() * 9)].address;
      if (exclude.includes(candidate)) return this.randomAddressFn({ exclude });

      return candidate;
    };

    // Bind a function that gets a random signed.
    // TODO(odd-amphora): Address type any.
    this.randomSignerFn = ({ exclude = [] }: { exclude?: any } = {}) => {
      // To test an edge condition, pick the same address more likely than not.
      // return address0 50% of the time.
      const candidate =
        Math.random() < 0.5 ? this.addrs[0] : this.addrs[Math.floor(Math.random() * 9)];
      if (exclude.includes(candidate.address)) return this.randomSignerFn({ exclude });
      return candidate;
    };

    // Bind a function that returns either true or false randomly.
    this.randomBoolFn = () => Math.random() > 0.5;

    // Bind a function that generates a random string.
    this.randomStringFn = ({
      exclude = [],
      prepend = '',
      canBeEmpty = true,
      favorEdges = true,
    }: {
      exclude?: string[];
      prepend?: string;
      canBeEmpty?: boolean;
      favorEdges?: boolean;
    } = {}) => {
      const seed = this.randomBigNumberFn({
        min: canBeEmpty ? BigNumber.from(0) : BigNumber.from(1),
        favorEdges,
      });
      const candidate = prepend.concat(Math.random().toString(36).substr(2, seed));
      if (exclude.includes(candidate)) return this.randomStringFn({ exclude, prepend, canBeEmpty });
      return candidate;
    };

    // Bind the big number utils.
    this.BigNumber = BigNumber;

    // Bind a function that returns a random set of bytes.
    this.randomBytesFn = ({
      min = BigNumber.from(10),
      max = BigNumber.from(32),
      prepend = '',
      exclude = [],
    }: { min?: BigNumber; max?: BigNumber; prepend?: string; exclude?: string[] } = {}) => {
      const candidate = utils.formatBytes32String(
        this.randomStringFn({
          prepend,
          seed: this.randomBigNumberFn({
            min,
            max,
          }),
          favorEdges: false,
        }),
      );
      if (exclude.includes(candidate)) return this.randomBytesFn({ exclude, min, max, prepend });
      return candidate;
    };

    this.stringToBytes = utils.formatBytes32String;

    // Bind functions for cleaning state.
    this.snapshotFn = () => hre.ethers.provider.send('evm_snapshot', []);
    this.restoreFn = (id: string) => hre.ethers.provider.send('evm_revert', [id]);
  });

  // Before each test, take a snapshot of the contract state.
  beforeEach(async function () {
    // Make the start time of the test available.
    this.testStart = await this.getTimestampFn();
  });

  // Run the tests.
  describe('Unit', unit);
  describe('Integration', integration);
});
