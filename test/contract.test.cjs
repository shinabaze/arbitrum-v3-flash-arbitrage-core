const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ArbProfitBot Core Contract", function () {
  let bot;
  let owner;
  let user;
  let mockPool1;
  let mockPool2;

  beforeEach(async function () {
    [owner, user, mockPool1, mockPool2] = await ethers.getSigners();

    const ArbProfitBot = await ethers.getContractFactory("ArbProfitBot");
    bot = await ArbProfitBot.deploy();
    await bot.waitForDeployment();
  });

  describe("Deployment & Access Control", function () {
    it("sets correct deployer as owner", async function () {
      expect(await bot.owner()).to.equal(owner.address);
    });

    it("reports correct engine version", async function () {
      expect(await bot.version()).to.equal("TITAN-V6-CORE");
    });

    it("allows owner to transfer ownership", async function () {
      await expect(bot.transferOwnership(user.address))
        .to.emit(bot, "OwnershipTransferred")
        .withArgs(owner.address, user.address);
      expect(await bot.owner()).to.equal(user.address);
    });

    it("prevents non-owner from transferring ownership", async function () {
      await expect(
        bot.connect(user).transferOwnership(user.address)
      ).to.be.revertedWith("Only owner");
    });
  });

  describe("Pool Authorization Matrix", function () {
    it("allows owner to authorize and revoke pools", async function () {
      await expect(bot.setAuthorizedPool(mockPool1.address, true))
        .to.emit(bot, "PoolAuthorizationUpdated")
        .withArgs(mockPool1.address, true);

      expect(await bot.authorizedPools(mockPool1.address)).to.be.true;

      await bot.setAuthorizedPool(mockPool1.address, false);
      expect(await bot.authorizedPools(mockPool1.address)).to.be.false;
    });

    it("supports batch pool authorization", async function () {
      await bot.batchSetAuthorizedPools([mockPool1.address, mockPool2.address], true);
      expect(await bot.authorizedPools(mockPool1.address)).to.be.true;
      expect(await bot.authorizedPools(mockPool2.address)).to.be.true;
    });

    it("rejects unauthorized pool management", async function () {
      await expect(
        bot.connect(user).setAuthorizedPool(mockPool1.address, true)
      ).to.be.revertedWith("Only owner");
    });
  });

  describe("Callback Security & Origin Verification", function () {
    it("reverts callback from unauthorized pool", async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address"],
        [mockPool1.address, ethers.ZeroAddress]
      );

      await expect(
        bot.connect(user).uniswapV3SwapCallback(100, -100, data)
      ).to.be.revertedWith("Callback: pool mismatch");
    });

    it("reverts flash loan caller if not Balancer Vault", async function () {
      const data = ethers.toUtf8Bytes("");
      await expect(
        bot.connect(user).receiveFlashLoan([], [1000], [0], data)
      ).to.be.revertedWith("Not Balancer Vault");
    });
  });

  describe("Sweeping and Withdrawals", function () {
    it("allows owner to withdraw native ETH balance", async function () {
      await owner.sendTransaction({
        to: await bot.getAddress(),
        value: ethers.parseEther("1.0"),
      });

      const balBefore = await ethers.provider.getBalance(owner.address);
      const tx = await bot.withdrawETH();
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(owner.address);

      expect(balAfter + gasCost - balBefore).to.equal(ethers.parseEther("1.0"));
    });

    it("protects sweeping functions from non-owners", async function () {
      await expect(
        bot.connect(user).sweepAll([ethers.ZeroAddress])
      ).to.be.revertedWith("Only owner");
      await expect(
        bot.connect(user).withdrawETH()
      ).to.be.revertedWith("Only owner");
    });
  });
});
